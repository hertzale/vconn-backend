const express = require('express');
const pool   = require('../config/db');
const auth   = require('../middleware/auth');
const genID  = require('../config/idGen');

const router = express.Router();

// See all reviews for a vehicle
router.get('/vehicle/:vehicleId', async (req, res) => {
  try {
    const [feedbacks] = await pool.query(
      `SELECT f.*, p.Name AS Customer_Name FROM FEEDBACK f
       JOIN PERSON p ON f.Customer_Account_ID = p.Account_ID
       WHERE f.Vehicle_ID = ? ORDER BY f.Date_Submitted DESC`,
      [req.params.vehicleId]
    );
    const avg = feedbacks.length
      ? (feedbacks.reduce((sum, f) => sum + f.Score, 0) / feedbacks.length).toFixed(1)
      : null;
    res.json({ success: true, data: feedbacks, average_score: avg });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Review submition
router.post('/', auth, async (req, res) => {
  const { transaction_id, score, comments } = req.body;
  if (!transaction_id || !score) return res.status(400).json({ success: false, message: 'transaction_id and score are required.' });
  if (score < 1 || score > 5) return res.status(400).json({ success: false, message: 'Score must be between 1 and 5.' });

  try {
    const [[tx]] = await pool.query(
      `SELECT * FROM RENTAL_TRANSACTION WHERE Transaction_ID = ? AND Customer_Account_ID = ?`,
      [transaction_id, req.user.account_id]
    );
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found or not yours.' });
    if (tx.Rental_Status !== 'Completed') return res.status(400).json({ success: false, message: 'You can only review after a completed rental.' });

    const [[existing]] = await pool.query(`SELECT Feedback_ID FROM FEEDBACK WHERE Transaction_ID = ?`, [transaction_id]);
    if (existing) return res.status(409).json({ success: false, message: 'You already submitted feedback for this rental.' });

    const feedbackID = await genID('FEEDBACK');
    const today      = new Date().toISOString().slice(0, 10);

    await pool.query(
      `INSERT INTO FEEDBACK (Feedback_ID, Vehicle_ID, Transaction_ID, Date_Submitted, Score, Customer_Account_ID, Comments)
       VALUES (?,?,?,?,?,?,?)`,
      [feedbackID, tx.Vehicle_ID, transaction_id, today, score, req.user.account_id, comments || null]
    );

    res.status(201).json({ success: true, message: 'Feedback submitted!', data: { feedback_id: feedbackID } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
