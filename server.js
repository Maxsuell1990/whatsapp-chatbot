const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8000';

// Middleware
app.use(cors());
app.use(express.json());

// Inicializar cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Estado do cliente
let clientReady = false;

// Eventos do cliente WhatsApp
client.on('qr', (qr) => {
    console.log('QR Code recebido, escaneie com seu WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Cliente WhatsApp está pronto!');
    clientReady = true;
});

client.on('authenticated', () => {
    console.log('Cliente WhatsApp autenticado!');
});

client.on('auth_failure', (msg) => {
    console.error('Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
    console.log('Cliente WhatsApp desconectado:', reason);
    clientReady = false;
});

// Manipular mensagens recebidas
client.on('message', async (message) => {
    try {
        // Ignorar mensagens de grupos e status
        if (message.from.includes('@g.us') || message.from.includes('status@broadcast')) {
            return;
        }

        console.log(`Mensagem recebida de ${message.from}: ${message.body}`);

        // Preparar dados para enviar ao orquestrador
        const messageData = {
            from: message.from,
            body: message.body,
            timestamp: message.timestamp,
            type: message.type
        };

        // Enviar para o orquestrador
        const response = await axios.post(`${ORCHESTRATOR_URL}/process-message`, messageData);
        
        if (response.data && response.data.reply) {
            // Enviar resposta de volta
            await client.sendMessage(message.from, response.data.reply);
            console.log(`Resposta enviada para ${message.from}: ${response.data.reply}`);
        }

    } catch (error) {
        console.error('Erro ao processar mensagem:', error.message);
        
        // Enviar mensagem de erro genérica
        try {
            await client.sendMessage(message.from, 
                'Desculpe, ocorreu um erro temporário. Tente novamente em alguns instantes.');
        } catch (sendError) {
            console.error('Erro ao enviar mensagem de erro:', sendError.message);
        }
    }
});

// Rotas da API
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        whatsapp_ready: clientReady,
        timestamp: new Date().toISOString()
    });
});

app.post('/send-message', async (req, res) => {
    try {
        const { to, message } = req.body;

        if (!clientReady) {
            return res.status(503).json({ error: 'Cliente WhatsApp não está pronto' });
        }

        if (!to || !message) {
            return res.status(400).json({ error: 'Campos "to" e "message" são obrigatórios' });
        }

        await client.sendMessage(to, message);
        res.json({ success: true, message: 'Mensagem enviada com sucesso' });

    } catch (error) {
        console.error('Erro ao enviar mensagem:', error.message);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.get('/status', (req, res) => {
    res.json({
        service: 'WhatsApp Gateway',
        status: clientReady ? 'connected' : 'disconnected',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    });
});

// Inicializar cliente WhatsApp
console.log('Inicializando cliente WhatsApp...');
client.initialize();

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gateway rodando na porta ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Encerrando aplicação...');
    if (clientReady) {
        await client.destroy();
    }
    process.exit(0);
});

