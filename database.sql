-- Run this in MySQL Workbench
-- This takes your groupmate's tables and makes them work properly

CREATE DATABASE IF NOT EXISTS vcunt_db;
USE vcunt_db;
SHOW DATABASES;


CREATE TABLE IF NOT EXISTS PERSON (
    Account_ID      VARCHAR(12)  NOT NULL,
    Name            VARCHAR(30)  NOT NULL,
    Address         VARCHAR(35)  NOT NULL,
    Email           VARCHAR(35)  UNIQUE,
    Contact_Number  VARCHAR(11)  UNIQUE,
    Drivers_License VARCHAR(10)  DEFAULT NULL,
    Password        VARCHAR(255) NOT NULL,
    PRIMARY KEY (Account_ID)
);

CREATE TABLE IF NOT EXISTS VEHICLE (
    Vehicle_ID        VARCHAR(12)   NOT NULL,
    Vehicle_Type      VARCHAR(10),
    Vehicle_Model     VARCHAR(30),
    Vehicle_Color     VARCHAR(12),
    Seat_Capacity     INT,
    Daily_Rate        DECIMAL(10,2),
    Plate_Number      VARCHAR(10)   UNIQUE,
    Registration_Date DATE          NOT NULL,
    Vehicle_Status    VARCHAR(20)   DEFAULT 'Available',
    Fuel_Type         VARCHAR(10),
    Owner_Account_ID  VARCHAR(12)   NOT NULL,
    PRIMARY KEY (Vehicle_ID),
    FOREIGN KEY (Owner_Account_ID) REFERENCES PERSON(Account_ID),
    CHECK (Vehicle_Status IN ('Available', 'Rented', 'Under Maintenance'))
);

CREATE TABLE IF NOT EXISTS RENTAL_TRANSACTION (
    Transaction_ID      VARCHAR(12)  NOT NULL,
    Vehicle_ID          VARCHAR(12),
    Transaction_Date    DATE         NOT NULL,
    Start_Date_and_Time DATETIME     NOT NULL,
    End_Date_and_Time   DATETIME     NOT NULL,
    Pickup_Location     VARCHAR(100),
    Drop_off_Location   VARCHAR(100),
    Rental_Duration     INT,
    With_Driver         TINYINT(1)   DEFAULT 0,
    Rental_Status       VARCHAR(20)  DEFAULT 'Pending',
    Customer_Account_ID VARCHAR(12)  NOT NULL,
    Owner_Account_ID    VARCHAR(12)  NOT NULL,
    PRIMARY KEY (Transaction_ID),
    FOREIGN KEY (Vehicle_ID)          REFERENCES VEHICLE(Vehicle_ID),
    FOREIGN KEY (Customer_Account_ID) REFERENCES PERSON(Account_ID),
    FOREIGN KEY (Owner_Account_ID)    REFERENCES PERSON(Account_ID),
    CHECK (Rental_Status IN ('Pending', 'Confirmed', 'Ongoing', 'Completed', 'Cancelled'))
);

CREATE TABLE IF NOT EXISTS PAYMENT (
    Payment_ID     VARCHAR(12)   NOT NULL,
    Transaction_ID VARCHAR(12)   NOT NULL,
    Total_Amount   DECIMAL(10,2) NOT NULL,
    Payment_Method VARCHAR(20)   DEFAULT 'Cash',
    Payment_Date   DATE          NOT NULL,
    Payment_Status VARCHAR(20)   DEFAULT 'Pending',
    PRIMARY KEY (Payment_ID),
    FOREIGN KEY (Transaction_ID) REFERENCES RENTAL_TRANSACTION(Transaction_ID),
    CHECK (Payment_Status IN ('Paid', 'Pending', 'Refunded')),
    CHECK (Payment_Method IN ('Cash'))
);

CREATE TABLE IF NOT EXISTS FEEDBACK (
    Feedback_ID         VARCHAR(12)  NOT NULL,
    Vehicle_ID          VARCHAR(12),
    Transaction_ID      VARCHAR(12)  UNIQUE,
    Date_Submitted      DATE         NOT NULL,
    Score               INT          NOT NULL,
    Customer_Account_ID VARCHAR(12)  NOT NULL,
    Comments            VARCHAR(150),
    PRIMARY KEY (Feedback_ID),
    FOREIGN KEY (Vehicle_ID)          REFERENCES VEHICLE(Vehicle_ID),
    FOREIGN KEY (Transaction_ID)      REFERENCES RENTAL_TRANSACTION(Transaction_ID),
    FOREIGN KEY (Customer_Account_ID) REFERENCES PERSON(Account_ID),
    CHECK (Score BETWEEN 1 AND 5)
);

-- Counter table so the backend can generate IDs like USER-0001, VH-001, etc.
CREATE TABLE IF NOT EXISTS ID_COUNTER (
    entity   VARCHAR(20) PRIMARY KEY,
    last_num INT DEFAULT 0
);

INSERT INTO ID_COUNTER (entity, last_num) VALUES
    ('PERSON', 0), ('VEHICLE', 0), ('TRANSACTION', 0),
    ('PAYMENT', 0), ('FEEDBACK', 0)
ON DUPLICATE KEY UPDATE entity = entity;
