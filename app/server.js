const express = require('express');
const redis = require('redis');
const promClient = require('prom-client');

const app = express();
const PORT = process.env.PORT || 8080;

// Prometheus Metrics Setup
const register = new promClient.Registry();

// Добавляем стандартные метрики Node.js
promClient.collectDefaultMetrics({
  register,
  prefix: 'nodejs_',
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
});

// Custom метрики
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
  registers: [register],
});

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const visitCounter = new promClient.Counter({
  name: 'page_visits_total',
  help: 'Total number of page visits',
  registers: [register],
});

// Redis Client Setup
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'redis',
    port: 6379,
  },
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('Connected to Redis');
});

(async () => {
  await redisClient.connect();
})();

// Middleware для метрик
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const route = req.route ? req.route.path : req.path;
    
    httpRequestDuration
      .labels(req.method, route, res.statusCode.toString())
      .observe(duration);
    
    httpRequestsTotal
      .labels(req.method, route, res.statusCode.toString())
      .inc();
  });
  
  next();
});
// Главная страница
app.get('/', async (req, res) => {
  try {
    // Увеличиваем счетчик визитов в Redis
    await redisClient.incr('visits');
    const visits = await redisClient.get('visits');
    
    visitCounter.inc();
    
    res.json({
      message: 'DevOps Practice App',
      visits: parseInt(visits),
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION || '1.0.0',
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Проверяем подключение к Redis
    await redisClient.ping();
    
    res.status(200).json({
      status: 'healthy',
      redis: 'connected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      redis: 'disconnected',
      error: error.message,
    });
  }
});

// Metrics endpoint для Prometheus
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Тестовый endpoint с искусственной задержкой
app.get('/slow', async (req, res) => {
  const delay = Math.random() * 2000; // 0-2 секунды
  setTimeout(() => {
    res.json({ message: 'Slow response', delay: Math.round(delay) });
  }, delay);
});

// Endpoint для тестирования ошибок
app.get('/error', (req, res) => {
  console.error('ERROR: Test error endpoint called');  // ← ЭТО ОБЯЗАТЕЛЬНО
  res.status(500).json({ error: 'Test error' });
});

app.get('/error', (req, res) => {
  console.error('ERROR: Test error endpoint called');
  res.status(500).json({ error: 'Test error' });
});

// Server Start
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Metrics available at http://localhost:${PORT}/metrics`);
  console.log(`Health check at http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await redisClient.quit();
  process.exit(0);
});