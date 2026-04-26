const express = require('express');
const pool   = require('../config/db');
const auth   = require('../middleware/auth');
const genID  = require('../config/idGen');

const router = express.Router();

// List all available vehicles 
router.get('/', async (req, res) => {
  try {
    let sql = `SELECT v.*, p.Name AS Owner_Name, p.Contact_Number AS Owner_Contact, p.Address AS Owner_Address
               FROM VEHICLE v JOIN PERSON p ON v.Owner_Account_ID = p.Account_ID
               WHERE v.Vehicle_Status = 'Available'`;
    const params = [];
    if (req.query.type) { sql += ` AND v.Vehicle_Type = ?`; params.push(req.query.type); }

    const [vehicles] = await pool.query(sql, params);
    res.json({ success: true, data: vehicles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// View owned vehicles 
router.get('/my', auth, async (req, res) => {
  try {
    const [vehicles] = await pool.query(
      `SELECT v.*, p.Address AS Owner_Address 
      FROM VEHICLE V
      JOIN PERSON p ON v.Owner_Account_ID = p.Account_ID
      WHERE v.Owner_Account_ID = ?`, [req.user.account_id]
    );
    res.json({ success: true, data: vehicles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// View vehicle's details
router.get('/:id', async (req, res) => {
  try {
    const [[vehicle]] = await pool.query(
      `SELECT v.*, p.Name AS Owner_Name, p.Contact_Number AS Owner_Contact
       FROM VEHICLE v JOIN PERSON p ON v.Owner_Account_ID = p.Account_ID
       WHERE v.Vehicle_ID = ?`,
      [req.params.id]
    );
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    res.json({ success: true, data: vehicle });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Vehicle listing 
router.post('/', auth, async (req, res) => {
  try {
    const [[person]] = await pool.query(
      `SELECT Drivers_License FROM PERSON WHERE Account_ID = ?`, [req.user.account_id]
    );
    if (!person?.Drivers_License) {
      return res.status(403).json({ success: false, message: 'You need a verified driver\'s license to list a vehicle.' });
    }

    const { vehicle_type, vehicle_model, vehicle_color, seat_capacity,
            daily_rate, plate_number, registration_date, fuel_type, with_driver } = req.body;

    if (!vehicle_type || !vehicle_model || !plate_number || !registration_date) {
      return res.status(400).json({ success: false, message: 'Please fill in all required vehicle fields.' });
    }

    const vehicleID = await genID('VEHICLE');
    await pool.query(
      `INSERT INTO VEHICLE (Vehicle_ID, Vehicle_Type, Vehicle_Model, Vehicle_Color, Seat_Capacity,
        Daily_Rate, Plate_Number, Registration_Date, Vehicle_Status, Fuel_Type, With_Driver, Owner_Account_ID)
       VALUES (?,?,?,?,?,?,?,?,'Available',?,?,?)`,
      [vehicleID, vehicle_type, vehicle_model, vehicle_color, seat_capacity,
       daily_rate, plate_number, registration_date, fuel_type || null, with_driver || 0, req.user.account_id]
    );

    res.status(201).json({ success: true, message: 'Vehicle listed!', data: { vehicle_id: vehicleID } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Update vehicle status
router.patch('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  if (!['Available', 'Rented', 'Under Maintenance'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status.' });
  }
  try {
    const [[v]] = await pool.query(`SELECT Owner_Account_ID FROM VEHICLE WHERE Vehicle_ID = ?`, [req.params.id]);
    if (!v) return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    if (v.Owner_Account_ID !== req.user.account_id) return res.status(403).json({ success: false, message: 'Not your vehicle.' });

    await pool.query(`UPDATE VEHICLE SET Vehicle_Status = ? WHERE Vehicle_ID = ?`, [status, req.params.id]);
    res.json({ success: true, message: `Status updated to ${status}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Deleting a listing
router.delete('/:id', auth, async (req, res) => {
  try {
    const [[v]] = await pool.query(`SELECT Owner_Account_ID, Vehicle_Status FROM VEHICLE WHERE Vehicle_ID = ?`, [req.params.id]);
    if (!v) return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    if (v.Owner_Account_ID !== req.user.account_id) return res.status(403).json({ success: false, message: 'Not your vehicle.' });
    if (v.Vehicle_Status === 'Rented') return res.status(400).json({ success: false, message: 'Cannot remove a vehicle that is currently rented.' });

    await pool.query(`DELETE FROM VEHICLE WHERE Vehicle_ID = ?`, [req.params.id]);
    res.json({ success: true, message: 'Vehicle removed.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// READ
router.put('/:id', auth, async (req, res) => {
  try {
    const [[v]] = await pool.query(
      `SELECT Owner_Account_ID FROM VEHICLE WHERE Vehicle_ID = ?`, 
      [req.params.id]
    )
    if (!v) return res.status(404).json({ 
      success: false, message: 'Vehicle not found.' 
    })
    if (v.Owner_Account_ID !== req.user.account_id) 
      return res.status(403).json({ 
        success: false, message: 'Not your vehicle.' 
      })

    const { vehicle_type, vehicle_model, vehicle_color, 
            seat_capacity, daily_rate, plate_number, 
            registration_date, fuel_type } = req.body

    await pool.query(
      `UPDATE VEHICLE SET 
        Vehicle_Type = ?, Vehicle_Model = ?, Vehicle_Color = ?,
        Seat_Capacity = ?, Daily_Rate = ?, Plate_Number = ?,
        Registration_Date = ?, Fuel_Type = ?
       WHERE Vehicle_ID = ?`,
      [vehicle_type, vehicle_model, vehicle_color,
       seat_capacity, daily_rate, plate_number,
       registration_date, fuel_type || null, req.params.id]
    )

    res.json({ success: true, message: 'Vehicle updated!' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ success: false, message: 'Server error.' })
  }
})

module.exports = router;
