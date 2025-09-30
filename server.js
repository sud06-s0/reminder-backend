const express = require('express');
const cors = require('cors');
require('dotenv').config();
const reminderScheduler = require('./reminderScheduler');

const app = express();

// CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173'
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Reminder Scheduler API is running',
    timestamp: new Date().toISOString(),
    scheduledJobs: reminderScheduler.scheduledJobs.size
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    scheduledJobs: reminderScheduler.scheduledJobs.size
  });
});

// Schedule reminder endpoint
app.post('/api/schedule-reminder', async (req, res) => {
  try {
    const { leadId, phone, parentsName, meetingDate, meetingTime, fieldType } = req.body;

    console.log('Received schedule request:', { leadId, phone, fieldType });

    if (!leadId || !phone || !parentsName || !meetingDate || !meetingTime) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        received: { leadId, phone, parentsName, meetingDate, meetingTime, fieldType }
      });
    }

    reminderScheduler.scheduleReminders(leadId, phone, parentsName, meetingDate, meetingTime, fieldType);

    res.json({ 
      success: true, 
      message: 'Reminders scheduled successfully',
      leadId,
      fieldType
    });
  } catch (error) {
    console.error('Error scheduling reminder:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel reminder endpoint
app.post('/api/cancel-reminder', async (req, res) => {
  try {
    const { leadId, fieldType } = req.body;

    console.log('Received cancel request:', { leadId, fieldType });

    if (!leadId) {
      return res.status(400).json({ error: 'Missing leadId' });
    }

    reminderScheduler.cancelReminders(leadId, fieldType);

    res.json({ 
      success: true, 
      message: 'Reminders cancelled successfully',
      leadId,
      fieldType
    });
  } catch (error) {
    console.error('Error cancelling reminder:', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

const PORT = process.env.PORT || 3001;

// Load pending reminders on server start
reminderScheduler.loadPendingReminders()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════╗
║   Reminder Scheduler Server Started   ║
╠════════════════════════════════════════╣
║   Port: ${PORT}                        
║   Environment: ${process.env.NODE_ENV || 'development'}
║   Scheduled Jobs: ${reminderScheduler.scheduledJobs.size}
╚════════════════════════════════════════╝
      `);
    });
  })
  .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
