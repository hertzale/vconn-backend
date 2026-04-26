const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const genID = require("../config/idGen");
require("dotenv").config();

const router = express.Router();

// Create a new account
router.post("/register", async (req, res) => {
  const { name, address, email, contact_number, password, drivers_license } =
    req.body;

  if (!name || !address || !email || !contact_number || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Please fill in all required fields." });
  }

  try {
    const [[exists]] = await pool.query(
      `SELECT Account_ID FROM PERSON WHERE Email = ? OR Contact_Number = ?`,
      [email, contact_number],
    );
    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Email or contact number already used.",
      });
    }

    const hashed = await bcrypt.hash(password, 10);
    const accountID = await genID("PERSON");

    console.log("Registering account:", {
      accountID,
      name,
      address,
      email,
      contact_number,
      drivers_license,
      password,
    });

    await pool.query(
      `INSERT INTO PERSON (Account_ID, Name, Address, Email, Contact_Number, Drivers_License, Password)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        accountID,
        name,
        address,
        email,
        contact_number,
        drivers_license || null,
        hashed,
      ],
    );

    const token = jwt.sign(
      { account_id: accountID, email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );

    res.status(201).json({
      success: true,
      message: "Account created!",
      data: { account_id: accountID, name, email, token },
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Server error during registration." });
  }
});

// User Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Email and password are required." });
  }

  try {
    const [[user]] = await pool.query(
      `SELECT Account_ID, Name, Email, Password, Drivers_License FROM PERSON WHERE Email = ?`,
      [email],
    );

    if (!user || !(await bcrypt.compare(password, user.Password))) {
      return res
        .status(401)
        .json({ success: false, message: "Wrong email or password." });
    }

    console.log("JWT_EXPIRES_IN:", process.env.JWT_EXPIRES_IN);

    const token = jwt.sign(
      { account_id: user.Account_ID, email: user.Email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );

    res.json({
      success: true,
      message: "Logged in successfully.",
      data: {
        account_id: user.Account_ID,
        name: user.Name,
        email: user.Email,
        has_license: !!user.Drivers_License,
        token,
      },
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Server error during login." });
  }
});

module.exports = router;
