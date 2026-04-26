const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth',         require('./routes/auth'));
app.use('/api/persons',      require('./routes/persons'));
app.use('/api/vehicles',     require('./routes/vehicles'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/payments',     require('./routes/payments'));
app.use('/api/feedback',     require('./routes/feedback'));

app.get('/', (req, res) => {
  res.json({ message: 'V-Connect API is running!', version: '1.0.0' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found.` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`V-Connect backend running on http://localhost:${PORT}`));
