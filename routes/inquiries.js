const express = require('express');
const pool    = require('../config/db');
const auth    = require('../middleware/auth');
const genID   = require('../config/idGen');

const router = express.Router();

// inquiries 
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*,
              v.Vehicle_Type, v.Vehicle_Model, v.Plate_Number, v.Daily_Rate,
              c.Name  AS Customer_Name,
              o.Name  AS Owner_Name,
              t.Trip_Name
       FROM INQUIRY i
       JOIN VEHICLE v ON i.Vehicle_ID          = v.Vehicle_ID
       JOIN PERSON  c ON i.Customer_Account_ID = c.Account_ID
       JOIN PERSON  o ON i.Owner_Account_ID    = o.Account_ID
       LEFT JOIN TRIP t ON i.Trip_ID           = t.Trip_ID
       WHERE i.Customer_Account_ID = ? OR i.Owner_Account_ID = ?
       ORDER BY i.Updated_At DESC`,
      [req.user.account_id, req.user.account_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/inquiries/:id ───────────────────────────────────
// Single inquiry (full details)
router.get('/:id', auth, async (req, res) => {
  try {
    const [[inquiry]] = await pool.query(
      `SELECT i.*,
              v.Vehicle_Type, v.Vehicle_Model, v.Plate_Number, v.Daily_Rate,
              v.Vehicle_Color, v.Seat_Capacity, v.Fuel_Type,
              c.Name  AS Customer_Name, c.Contact_Number AS Customer_Contact,
              o.Name  AS Owner_Name,    o.Contact_Number AS Owner_Contact,
              t.Trip_Name
       FROM INQUIRY i
       JOIN VEHICLE v ON i.Vehicle_ID          = v.Vehicle_ID
       JOIN PERSON  c ON i.Customer_Account_ID = c.Account_ID
       JOIN PERSON  o ON i.Owner_Account_ID    = o.Account_ID
       LEFT JOIN TRIP t ON i.Trip_ID           = t.Trip_ID
       WHERE i.Inquiry_ID = ?`,
      [req.params.id]
    );
    if (!inquiry) return res.status(404).json({ success: false, message: 'Inquiry not found.' });
    if (inquiry.Customer_Account_ID !== req.user.account_id &&
        inquiry.Owner_Account_ID    !== req.user.account_id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    res.json({ success: true, data: inquiry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Customer sends an inquiry to a vehicle owner
router.post('/', auth, async (req, res) => {
  const {
    vehicle_id, trip_id, rental_duration,
    distance_km, pickup_location, drop_off_location,
    start_date, end_date, with_driver, customer_message
  } = req.body;

  if (!vehicle_id || !rental_duration || !pickup_location || !drop_off_location) {
    return res.status(400).json({
      success: false,
      message: 'vehicle_id, rental_duration, pickup_location, and drop_off_location are required.'
    });
  }

  try {
    // Vehicle must exist
    const [[vehicle]] = await pool.query(`SELECT * FROM VEHICLE WHERE Vehicle_ID = ?`, [vehicle_id]);
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found.' });

    // Cannot inquire about your own vehicle
    if (vehicle.Owner_Account_ID === req.user.account_id) {
      return res.status(400).json({ success: false, message: 'You cannot inquire about your own vehicle.' });
    }

    // Validate trip ownership and prevent duplicate inquiry per vehicle per trip
    if (trip_id) {
      const [[trip]] = await pool.query(
        `SELECT Trip_ID FROM TRIP WHERE Trip_ID = ? AND Customer_Account_ID = ?`,
        [trip_id, req.user.account_id]
      );
      if (!trip) return res.status(404).json({ success: false, message: 'Trip not found or not yours.' });

      const [[dup]] = await pool.query(
        `SELECT Inquiry_ID FROM INQUIRY
         WHERE Trip_ID = ? AND Vehicle_ID = ? AND Inquiry_Status NOT IN ('Cancelled')`,
        [trip_id, vehicle_id]
      );
      if (dup) {
        return res.status(409).json({
          success: false,
          message: 'An active inquiry for this vehicle already exists in this trip.'
        });
      }
    }

    const inquiryID = await genID('INQUIRY');
    const today     = new Date().toISOString().slice(0, 10);

    await pool.query(
      `INSERT INTO INQUIRY
         (Inquiry_ID, Trip_ID, Vehicle_ID, Customer_Account_ID, Owner_Account_ID,
          Rental_Duration, Distance_KM, Pickup_Location, Drop_off_Location,
          Start_Date, End_Date, With_Driver, Customer_Message, Inquiry_Status, Inquiry_Date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'Pending',?)`,
      [
        inquiryID, trip_id || null, vehicle_id,
        req.user.account_id, vehicle.Owner_Account_ID,
        rental_duration, distance_km || null,
        pickup_location, drop_off_location,
        start_date || null, end_date || null,
        with_driver ? 1 : 0,
        customer_message || null,
        today
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Inquiry sent! Waiting for the owner to respond.',
      data: { inquiry_id: inquiryID }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Owner responds with a price [RANGE or a FIXED price]
router.patch('/:id/quote', auth, async (req, res) => {
  const { response_type, price_min, price_max, set_price, owner_message } = req.body;

  if (!response_type || !['range', 'fixed'].includes(response_type)) {
    return res.status(400).json({ success: false, message: 'response_type must be "range" or "fixed".' });
  }
  if (response_type === 'range') {
    if (!price_min || !price_max)
      return res.status(400).json({ success: false, message: 'price_min and price_max are required for a range quote.' });
    if (Number(price_min) >= Number(price_max))
      return res.status(400).json({ success: false, message: 'price_min must be less than price_max.' });
  }
  if (response_type === 'fixed' && !set_price) {
    return res.status(400).json({ success: false, message: 'set_price is required for a fixed quote.' });
  }

  try {
    const [[inquiry]] = await pool.query(`SELECT * FROM INQUIRY WHERE Inquiry_ID = ?`, [req.params.id]);
    if (!inquiry) return res.status(404).json({ success: false, message: 'Inquiry not found.' });
    if (inquiry.Owner_Account_ID !== req.user.account_id)
      return res.status(403).json({ success: false, message: 'Only the vehicle owner can quote on this inquiry.' });
    if (inquiry.Inquiry_Status !== 'Pending')
      return res.status(400).json({ success: false, message: `Cannot quote on an inquiry with status "${inquiry.Inquiry_Status}".` });

    await pool.query(
      `UPDATE INQUIRY SET
         Inquiry_Status      = 'Owner_Quoted',
         Owner_Response_Type = ?,
         Owner_Price_Min     = ?,
         Owner_Price_Max     = ?,
         Owner_Set_Price     = ?,
         Owner_Message       = ?
       WHERE Inquiry_ID = ?`,
      [
        response_type,
        response_type === 'range' ? price_min : null,
        response_type === 'range' ? price_max : null,
        response_type === 'fixed' ? set_price : null,
        owner_message || null,
        req.params.id
      ]
    );

    const msg = response_type === 'range'
      ? `Owner quoted a price range of ₱${price_min}–₱${price_max}. Customer must now submit a counter-price.`
      : `Owner quoted a fixed price of ₱${set_price}. Customer can accept, decline, or negotiate.`;

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Customer responds after owner has quoted
router.patch('/:id/respond', auth, async (req, res) => {
  const { decision, counter_price, customer_counter_message } = req.body;

  try {
    const [[inquiry]] = await pool.query(`SELECT * FROM INQUIRY WHERE Inquiry_ID = ?`, [req.params.id]);
    if (!inquiry) return res.status(404).json({ success: false, message: 'Inquiry not found.' });
    if (inquiry.Customer_Account_ID !== req.user.account_id)
      return res.status(403).json({ success: false, message: 'Only the customer can respond to a quote.' });
    if (inquiry.Inquiry_Status !== 'Owner_Quoted')
      return res.status(400).json({ success: false, message: `Cannot respond to an inquiry with status "${inquiry.Inquiry_Status}".` });

    let newStatus;
    let finalPrice = null;
    let resolvedDecision = decision;

    if (inquiry.Owner_Response_Type === 'range') {
      // If the owner gave a range then customer must counter with a specific price
      if (!counter_price)
        return res.status(400).json({ success: false, message: 'counter_price is required when owner gave a range.' });
      newStatus        = 'Negotiating';
      resolvedDecision = 'negotiate';

    } else {
      // If the owner gave a fixed price then customer decides yes/no/negotiate
      if (!decision || !['accept', 'decline', 'negotiate'].includes(decision))
        return res.status(400).json({ success: false, message: 'decision must be "accept", "decline", or "negotiate".' });
      if (decision === 'negotiate' && !counter_price)
        return res.status(400).json({ success: false, message: 'counter_price is required when negotiating.' });

      if (decision === 'accept') {
        newStatus  = 'Confirmed';
        finalPrice = inquiry.Owner_Set_Price;
      } else if (decision === 'decline') {
        newStatus = 'Cancelled';
      } else {
        newStatus = 'Negotiating';
      }
    }

    await pool.query(
      `UPDATE INQUIRY SET
         Inquiry_Status           = ?,
         Customer_Decision        = ?,
         Customer_Counter_Price   = ?,
         Customer_Counter_Message = ?,
         Final_Agreed_Price       = ?
       WHERE Inquiry_ID = ?`,
      [newStatus, resolvedDecision, counter_price || null, customer_counter_message || null, finalPrice, req.params.id]
    );

    const messages = {
      Confirmed:   'You accepted the price! Inquiry confirmed. You can now book the vehicle.',
      Cancelled:   'You declined the offer. Inquiry cancelled.',
      Negotiating: 'Your counter-offer has been sent to the owner.'
    };

    res.json({
      success: true,
      message: messages[newStatus],
      data: { new_status: newStatus, final_price: finalPrice }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Owner accepts or declines the customer's counter-offer
router.patch('/:id/finalize', auth, async (req, res) => {
  const { decision } = req.body;
  if (!decision || !['accept', 'decline'].includes(decision))
    return res.status(400).json({ success: false, message: 'decision must be "accept" or "decline".' });

  try {
    const [[inquiry]] = await pool.query(`SELECT * FROM INQUIRY WHERE Inquiry_ID = ?`, [req.params.id]);
    if (!inquiry) return res.status(404).json({ success: false, message: 'Inquiry not found.' });
    if (inquiry.Owner_Account_ID !== req.user.account_id)
      return res.status(403).json({ success: false, message: 'Only the owner can finalize negotiation.' });
    if (inquiry.Inquiry_Status !== 'Negotiating')
      return res.status(400).json({ success: false, message: `Cannot finalize an inquiry with status "${inquiry.Inquiry_Status}".` });

    const newStatus  = decision === 'accept' ? 'Confirmed' : 'Cancelled';
    const finalPrice = decision === 'accept' ? inquiry.Customer_Counter_Price : null;

    await pool.query(
      `UPDATE INQUIRY SET Inquiry_Status = ?, Final_Agreed_Price = ? WHERE Inquiry_ID = ?`,
      [newStatus, finalPrice, req.params.id]
    );

    const msg = decision === 'accept'
      ? `You accepted the counter-offer of ₱${finalPrice}. Inquiry is now confirmed!`
      : 'You declined the counter-offer. Inquiry has been cancelled.';

    res.json({ success: true, message: msg, data: { new_status: newStatus, final_price: finalPrice } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Customer converts a Confirmed inquiry into an actual Transaction + Payment.
// The agreed price from negotiation becomes the payment amount.
router.post('/:id/book', auth, async (req, res) => {
  try {
    const [[inquiry]] = await pool.query(`SELECT * FROM INQUIRY WHERE Inquiry_ID = ?`, [req.params.id]);
    if (!inquiry) return res.status(404).json({ success: false, message: 'Inquiry not found.' });
    if (inquiry.Customer_Account_ID !== req.user.account_id)
      return res.status(403).json({ success: false, message: 'Only the customer can book from an inquiry.' });
    if (inquiry.Inquiry_Status !== 'Confirmed')
      return res.status(400).json({ success: false, message: 'Only a Confirmed inquiry can be converted to a booking.' });

    const [[vehicle]] = await pool.query(`SELECT * FROM VEHICLE WHERE Vehicle_ID = ?`, [inquiry.Vehicle_ID]);
    if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found.' });
    if (vehicle.Vehicle_Status !== 'Available')
      return res.status(409).json({ success: false, message: 'Vehicle is no longer available.' });

    // Driver's license check
    if (!inquiry.With_Driver) {
      const [[me]] = await pool.query(`SELECT Drivers_License FROM PERSON WHERE Account_ID = ?`, [req.user.account_id]);
      if (!me?.Drivers_License)
        return res.status(403).json({ success: false, message: "You need a driver's license to rent without a driver." });
    }

    const txID      = await genID('TRANSACTION');
    const paymentID = await genID('PAYMENT');
    const today     = new Date().toISOString().slice(0, 10);

    // Create transaction (starts as Confirmed because negotiation already happened)
    await pool.query(
      `INSERT INTO RENTAL_TRANSACTION
         (Transaction_ID, Vehicle_ID, Transaction_Date, Start_Date_and_Time, End_Date_and_Time,
          Pickup_Location, Drop_off_Location, Rental_Duration, With_Driver, Rental_Status,
          Customer_Account_ID, Owner_Account_ID)
       VALUES (?,?,?,?,?,?,?,?,?,'Confirmed',?,?)`,
      [
        txID, inquiry.Vehicle_ID, today,
        inquiry.Start_Date, inquiry.End_Date,
        inquiry.Pickup_Location, inquiry.Drop_off_Location,
        inquiry.Rental_Duration, inquiry.With_Driver,
        req.user.account_id, inquiry.Owner_Account_ID
      ]
    );

    // Mark vehicle as Rented
    await pool.query(`UPDATE VEHICLE SET Vehicle_Status = 'Rented' WHERE Vehicle_ID = ?`, [inquiry.Vehicle_ID]);

    // Create payment using the final negotiated price
    await pool.query(
      `INSERT INTO PAYMENT (Payment_ID, Transaction_ID, Total_Amount, Payment_Method, Payment_Date, Payment_Status)
       VALUES (?,?,?,'Cash',?,'Pending')`,
      [paymentID, txID, inquiry.Final_Agreed_Price, today]
    );

    // Mark inquiry as Booked and link to the transaction
    await pool.query(
      `UPDATE INQUIRY SET Inquiry_Status = 'Booked', Transaction_ID = ? WHERE Inquiry_ID = ?`,
      [txID, req.params.id]
    );

    res.status(201).json({
      success: true,
      message: 'Booking created from your confirmed inquiry!',
      data: {
        transaction_id: txID,
        payment_id:     paymentID,
        final_price:    inquiry.Final_Agreed_Price
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// This if to allow either party to cancel an inquiry while it is Pending or Negotiating if they want to
router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    const [[inquiry]] = await pool.query(`SELECT * FROM INQUIRY WHERE Inquiry_ID = ?`, [req.params.id]);
    if (!inquiry) return res.status(404).json({ success: false, message: 'Inquiry not found.' });

    const isParty =
      inquiry.Customer_Account_ID === req.user.account_id ||
      inquiry.Owner_Account_ID    === req.user.account_id;
    if (!isParty) return res.status(403).json({ success: false, message: 'Access denied.' });

    if (['Confirmed', 'Cancelled', 'Booked'].includes(inquiry.Inquiry_Status))
      return res.status(400).json({ success: false, message: `Cannot cancel an inquiry with status "${inquiry.Inquiry_Status}".` });

    await pool.query(`UPDATE INQUIRY SET Inquiry_Status = 'Cancelled' WHERE Inquiry_ID = ?`, [req.params.id]);
    res.json({ success: true, message: 'Inquiry cancelled.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
