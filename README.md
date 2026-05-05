# Re-Mmogo — Backend API

Node.js + Express REST API for the Re-Mmogo Motshelo group management web app.

---

## Tech Stack

| Layer        | Technology              |
|-------------|--------------------------|
| Runtime      | Node.js 18+             |
| Framework    | Express 4               |
| Database     | SQL Server (mssql)      |
| Auth         | JWT + bcryptjs          |
| Validation   | express-validator        |

---

## Folder Structure

```
server/
├── config/
│   └── db.js                  # SQL Server connection pool
├── controllers/
│   ├── authController.js
│   ├── groupController.js
│   ├── membersController.js
│   ├── contributionsController.js
│   ├── loansController.js
│   └── reportsController.js
├── middleware/
│   ├── auth.js                # JWT protect + signatory guard
│   └── errorHandler.js
├── routes/
│   ├── auth.js
│   ├── group.js
│   ├── members.js
│   ├── contributions.js
│   ├── loans.js
│   └── reports.js
├── db/
│   └── schema.sql             # Run this ONCE to create all tables
├── .env.example
├── .gitignore
├── package.json
└── server.js
```

---

## Setup

### 1. Install dependencies
```bash
cd server
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Edit `.env` and fill in your SQL Server credentials and a strong JWT secret.

### 3. Create the database
Open SQL Server Management Studio (SSMS) and run `db/schema.sql`.  
This creates the `ReMmogoDb` database and all tables.

### 4. Start the server
```bash
# Development (auto-restart on save)
npm run dev

# Production
npm start
```

Server runs on **http://localhost:5000** by default.

---

## API Endpoints

### Auth
| Method | Path                  | Access  | Description              |
|--------|-----------------------|---------|--------------------------|
| POST   | /api/auth/register    | Public  | Register group + first signatory |
| POST   | /api/auth/login       | Public  | Login, receive JWT       |

### Group
| Method | Path       | Access     | Description        |
|--------|------------|------------|--------------------|
| GET    | /api/group | Protected  | Get group details  |
| PUT    | /api/group | Signatory  | Update group info  |

### Members
| Method | Path            | Access    | Description         |
|--------|-----------------|-----------|---------------------|
| GET    | /api/members    | Protected | List all members    |
| GET    | /api/members/:id| Protected | Get one member      |
| POST   | /api/members    | Signatory | Enroll new member   |

### Contributions
| Method | Path                         | Access    | Description                |
|--------|------------------------------|-----------|----------------------------|
| GET    | /api/contributions           | Protected | List all contributions     |
| POST   | /api/contributions           | Protected | Record monthly payment     |
| PATCH  | /api/contributions/:id/approve | Signatory | Approve a contribution   |
| PATCH  | /api/contributions/:id/reject  | Signatory | Reject a contribution    |

### Loans
| Method | Path                                 | Access    | Description                        |
|--------|--------------------------------------|-----------|------------------------------------|
| GET    | /api/loans                           | Protected | List all loans with payments       |
| POST   | /api/loans                           | Protected | Apply for a loan                   |
| PATCH  | /api/loans/:id/approve               | Signatory | Approve loan (2 needed to disburse)|
| PATCH  | /api/loans/:id/reject                | Signatory | Reject loan                        |
| POST   | /api/loans/:id/payments              | Protected | Record loan repayment              |
| PATCH  | /api/loans/payments/:paymentId/approve | Signatory | Approve repayment (2 needed)     |
| PATCH  | /api/loans/payments/:paymentId/reject  | Signatory | Reject repayment                 |
| POST   | /api/loans/apply-interest            | Signatory | Apply 20% monthly interest         |

### Reports
| Method | Path                     | Access    | Description           |
|--------|--------------------------|-----------|-----------------------|
| GET    | /api/reports/yearend     | Protected | Year-end member report|

---

## Signatory Approval Flow

Both **loan disbursement** and **loan repayment recording** require two signatory approvals:

1. Member submits → status = `pending`
2. Signatory 1 hits `/approve` → approval recorded, status still `pending`
3. Signatory 2 hits `/approve` → status flips to `approved`, action executes
4. Same signatory cannot approve twice (returns 400 error)

---

## Default Member Password

When a signatory enrolls a new member via `POST /api/members`, the response includes a `defaultPassword` field (shown **once only**). The format is `emailprefix1234` — e.g., if email is `thabo@gmail.com`, the default password is `thabo1234`. Share it securely and advise the member to change it.
