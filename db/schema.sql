-- ============================================================
-- Re-Mmogo Database Schema
-- Run this script once to set up your SQL Server database.
-- ============================================================

USE master;
GO

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'ReMmogoDb')
  CREATE DATABASE ReMmogoDb;
GO

USE ReMmogoDb;
GO

-- ============================================================
-- GROUPS  (one group per deployment is typical, but supports multi)
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE name = 'Groups' AND type = 'U')
CREATE TABLE Groups (
  group_id      INT IDENTITY(1,1) PRIMARY KEY,
  name          NVARCHAR(200)  NOT NULL,
  description   NVARCHAR(500),
  target_amount DECIMAL(12,2)  NOT NULL DEFAULT 1000.00,  -- monthly contribution per member
  created_at    DATETIME2      NOT NULL DEFAULT GETDATE()
);
GO

-- ============================================================
-- MEMBERS
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE name = 'Members' AND type = 'U')
CREATE TABLE Members (
  member_id   INT IDENTITY(1,1) PRIMARY KEY,
  group_id    INT            NOT NULL REFERENCES Groups(group_id),
  name        NVARCHAR(200)  NOT NULL,
  email       NVARCHAR(200)  NOT NULL UNIQUE,
  phone       NVARCHAR(30),
  password    NVARCHAR(300)  NOT NULL,           -- bcrypt hash
  role        NVARCHAR(20)   NOT NULL DEFAULT 'member' CHECK (role IN ('member','signatory')),
  status      NVARCHAR(20)   NOT NULL DEFAULT 'active'  CHECK (status IN ('active','inactive')),
  join_date   DATE           NOT NULL DEFAULT CAST(GETDATE() AS DATE),
  created_at  DATETIME2      NOT NULL DEFAULT GETDATE()
);
GO

-- ============================================================
-- CONTRIBUTIONS  (P1000 per month per member)
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE name = 'Contributions' AND type = 'U')
CREATE TABLE Contributions (
  contribution_id INT IDENTITY(1,1) PRIMARY KEY,
  member_id       INT            NOT NULL REFERENCES Members(member_id),
  group_id        INT            NOT NULL REFERENCES Groups(group_id),
  amount          DECIMAL(12,2)  NOT NULL DEFAULT 1000.00,
  month           NVARCHAR(7)    NOT NULL,          -- e.g. '2025-05'
  status          NVARCHAR(20)   NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  proof_url       NVARCHAR(500),                    -- optional proof-of-payment
  submitted_at    DATETIME2      NOT NULL DEFAULT GETDATE(),
  approved_by     INT REFERENCES Members(member_id),
  approved_at     DATETIME2
);
GO

-- ============================================================
-- LOANS
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE name = 'Loans' AND type = 'U')
CREATE TABLE Loans (
  loan_id        INT IDENTITY(1,1) PRIMARY KEY,
  member_id      INT            NOT NULL REFERENCES Members(member_id),
  group_id       INT            NOT NULL REFERENCES Groups(group_id),
  principal      DECIMAL(12,2)  NOT NULL,
  balance        DECIMAL(12,2)  NOT NULL,           -- outstanding balance
  interest_rate  DECIMAL(5,4)   NOT NULL DEFAULT 0.20, -- 20% monthly
  reason         NVARCHAR(500),
  status         NVARCHAR(20)   NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','fully_paid')),
  disbursed_at   DATETIME2,
  date_taken     DATE           NOT NULL DEFAULT CAST(GETDATE() AS DATE),
  created_at     DATETIME2      NOT NULL DEFAULT GETDATE()
);
GO

-- ============================================================
-- LOAN PAYMENTS  (repayments)
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE name = 'LoanPayments' AND type = 'U')
CREATE TABLE LoanPayments (
  payment_id  INT IDENTITY(1,1) PRIMARY KEY,
  loan_id     INT            NOT NULL REFERENCES Loans(loan_id),
  member_id   INT            NOT NULL REFERENCES Members(member_id),
  amount      DECIMAL(12,2)  NOT NULL,
  proof_url   NVARCHAR(500),
  status      NVARCHAR(20)   NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  submitted_at DATETIME2     NOT NULL DEFAULT GETDATE(),
  approved_by INT REFERENCES Members(member_id),
  approved_at DATETIME2
);
GO

-- ============================================================
-- APPROVALS  (two-signatory log for loans and loan payments)
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE name = 'Approvals' AND type = 'U')
CREATE TABLE Approvals (
  approval_id   INT IDENTITY(1,1) PRIMARY KEY,
  entity_type   NVARCHAR(20)  NOT NULL CHECK (entity_type IN ('loan','loan_payment','contribution')),
  entity_id     INT           NOT NULL,
  signatory_id  INT           NOT NULL REFERENCES Members(member_id),
  action        NVARCHAR(10)  NOT NULL DEFAULT 'approve' CHECK (action IN ('approve','reject')),
  approved_at   DATETIME2     NOT NULL DEFAULT GETDATE(),
  CONSTRAINT UQ_Approval UNIQUE (entity_type, entity_id, signatory_id)
);
GO

-- ============================================================
-- Index for fast approval lookups
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Approvals_Entity')
  CREATE INDEX IX_Approvals_Entity ON Approvals(entity_type, entity_id);
GO

PRINT 'Schema created successfully.';
