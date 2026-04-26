const express = require('express');
const pool   = require('../config/db');
const auth   = require('../middleware/auth');

const router = express.Router();

// Get your own profile
router.get('/me', auth, async (req, res) => {
  try {
    const [[person]] = await pool.query(
      `SELECT Account_ID, Name, Address, Email, Contact_Number, Drivers_License FROM PERSON WHERE Account_ID = ?`,
      [req.user.account_id]
    );
    if (!person) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, data: person });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Profile Update 
router.put('/me', auth, async (req, res) => {
  const { name, address, contact_number, drivers_license } = req.body;
  try {
    await pool.query(
      `UPDATE PERSON SET Name=?, Address=?, Contact_Number=?, Drivers_License=? WHERE Account_ID=?`,
      [name, address, contact_number, drivers_license || null, req.user.account_id]
    );
    res.json({ success: true, message: 'Profile updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// View other user's basic info 
router.get('/:id', auth, async (req, res) => {
  try {
    const [[person]] = await pool.query(
      `SELECT Account_ID, Name, Email, Contact_Number FROM PERSON WHERE Account_ID = ?`,
      [req.params.id]
    );
    if (!person) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, data: person });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
