const express = require('express');
const pool    = require('../config/db');
const auth    = require('../middleware/auth');
const genID   = require('../config/idGen');

const router = express.Router();

// TRIP for grouping inquiries sent to multiple vehicle owners for the same planned rental/trip
router.post('/', auth, async (req, res) => {
  const { trip_name, planned_start, planned_end, pickup_location, drop_off_location } = req.body;

  if (!trip_name)
    return res.status(400).json({ success: false, message: 'trip_name is required.' });

  try {
    const tripID = await genID('TRIP');
    const today  = new Date().toISOString().slice(0, 10);

    await pool.query(
      `INSERT INTO TRIP
         (Trip_ID, Customer_Account_ID, Trip_Name, Planned_Start, Planned_End,
          Pickup_Location, Drop_off_Location, Created_Date)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        tripID, req.user.account_id, trip_name,
        planned_start || null, planned_end || null,
        pickup_location || null, drop_off_location || null,
        today
      ]
    );

    res.status(201).json({ success: true, message: 'Trip created!', data: { trip_id: tripID } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// List all trips for the logged-in customer with inquiry counts
router.get('/', auth, async (req, res) => {
  try {
    const [trips] = await pool.query(
      `SELECT t.*,
              COUNT(i.Inquiry_ID)                                              AS Total_Inquiries,
              SUM(CASE WHEN i.Inquiry_Status = 'Confirmed' THEN 1 ELSE 0 END) AS Confirmed_Count,
              SUM(CASE WHEN i.Inquiry_Status = 'Booked'    THEN 1 ELSE 0 END) AS Booked_Count,
              SUM(CASE WHEN i.Inquiry_Status = 'Pending'   THEN 1 ELSE 0 END) AS Pending_Count,
              SUM(CASE WHEN i.Inquiry_Status = 'Cancelled' THEN 1 ELSE 0 END) AS Cancelled_Count
       FROM TRIP t
       LEFT JOIN INQUIRY i ON t.Trip_ID = i.Trip_ID
       WHERE t.Customer_Account_ID = ?
       GROUP BY t.Trip_ID
       ORDER BY t.Created_Date DESC`,
      [req.user.account_id]
    );
    res.json({ success: true, data: trips });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Get a trip with ALL its inquiries, sorted by price and labeled.
router.get('/:id', auth, async (req, res) => {
  const sortDir = req.query.sort === 'asc' ? 'ASC' : 'DESC';

  try {
    const [[trip]] = await pool.query(
      `SELECT * FROM TRIP WHERE Trip_ID = ? AND Customer_Account_ID = ?`,
      [req.params.id, req.user.account_id]
    );
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found or not yours.' });

    const [inquiries] = await pool.query(
      `SELECT i.*,
              v.Vehicle_Type, v.Vehicle_Model, v.Plate_Number,
              v.Daily_Rate, v.Vehicle_Color, v.Seat_Capacity, v.Fuel_Type,
              o.Name           AS Owner_Name,
              o.Contact_Number AS Owner_Contact
       FROM INQUIRY i
       JOIN VEHICLE v ON i.Vehicle_ID       = v.Vehicle_ID
       JOIN PERSON  o ON i.Owner_Account_ID = o.Account_ID
       WHERE i.Trip_ID = ?`,
      [req.params.id]
    );

    // Calculate effective price for each inquiry 
    const withPrice = inquiries.map(inq => {
      let effectivePrice = null;

      if (inq.Final_Agreed_Price) {
        effectivePrice = parseFloat(inq.Final_Agreed_Price);
      } else if (inq.Owner_Response_Type === 'fixed' && inq.Owner_Set_Price) {
        effectivePrice = parseFloat(inq.Owner_Set_Price);
      } else if (inq.Owner_Response_Type === 'range' && inq.Owner_Price_Min && inq.Owner_Price_Max) {
        effectivePrice = (parseFloat(inq.Owner_Price_Min) + parseFloat(inq.Owner_Price_Max)) / 2;
      } else if (inq.Daily_Rate) {
        effectivePrice = parseFloat(inq.Daily_Rate) * Number(inq.Rental_Duration);
      }

      return { ...inq, Effective_Price: effectivePrice };
    });

    // Sort 
    withPrice.sort((a, b) => {
      if (a.Effective_Price === null && b.Effective_Price === null) return 0;
      if (a.Effective_Price === null) return 1;   // nulls go to the end
      if (b.Effective_Price === null) return -1;
      return sortDir === 'ASC'
        ? a.Effective_Price - b.Effective_Price
        : b.Effective_Price - a.Effective_Price;
    });

    // Determine labels for active inquiries
    const active = withPrice.filter(
      i => !['Cancelled'].includes(i.Inquiry_Status) && i.Effective_Price !== null
    );

    let cheapestId      = null;
    let mostExpensiveId = null;
    let bestPricedId    = null;

    if (active.length > 0) {
      const prices     = active.map(i => i.Effective_Price);
      const minPrice   = Math.min(...prices);
      const maxPrice   = Math.max(...prices);

      cheapestId      = active.find(i => i.Effective_Price === minPrice)?.Inquiry_ID ?? null;
      mostExpensiveId = active.find(i => i.Effective_Price === maxPrice)?.Inquiry_ID ?? null;

      // Best Priced / Median price
      const sorted    = [...active].sort((a, b) => a.Effective_Price - b.Effective_Price);
      const medIdx    = Math.floor(sorted.length / 2);
      const median    = sorted[medIdx]?.Effective_Price ?? 0;
      const closest   = active.reduce((prev, curr) =>
        Math.abs(curr.Effective_Price - median) < Math.abs(prev.Effective_Price - median) ? curr : prev
      );
      bestPricedId = closest?.Inquiry_ID ?? null;
    }

    // Attach labels 
    const labeled = withPrice.map(inq => {
      const labels = [];
      if (inq.Inquiry_ID === cheapestId)      labels.push('Cheapest');
      if (inq.Inquiry_ID === mostExpensiveId) labels.push('Most Expensive');
      if (inq.Inquiry_ID === bestPricedId)    labels.push('Best Priced');
      return { ...inq, Labels: labels };
    });

    // Summary 
    const summary = {
      total:      inquiries.length,
      active:     active.length,
      cancelled:  inquiries.filter(i => i.Inquiry_Status === 'Cancelled').length,
      confirmed:  inquiries.filter(i => i.Inquiry_Status === 'Confirmed').length,
      booked:     inquiries.filter(i => i.Inquiry_Status === 'Booked').length,
      sort_order: sortDir === 'ASC' ? 'Low to High' : 'High to Low'
    };

    res.json({ success: true, data: { trip, inquiries: labeled, summary } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Delete a trip and all its inquiries and blocked if any inquiry is Confirmed or Booked.
router.delete('/:id', auth, async (req, res) => {
  try {
    const [[trip]] = await pool.query(
      `SELECT * FROM TRIP WHERE Trip_ID = ? AND Customer_Account_ID = ?`,
      [req.params.id, req.user.account_id]
    );
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found or not yours.' });

    const [[blocked]] = await pool.query(
      `SELECT Inquiry_ID FROM INQUIRY
       WHERE Trip_ID = ? AND Inquiry_Status IN ('Confirmed', 'Booked')`,
      [req.params.id]
    );
    if (blocked)
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a trip that has Confirmed or Booked inquiries.'
      });

    await pool.query(`DELETE FROM INQUIRY WHERE Trip_ID = ?`, [req.params.id]);
    await pool.query(`DELETE FROM TRIP    WHERE Trip_ID = ?`, [req.params.id]);

    res.json({ success: true, message: 'Trip and all its inquiries deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
