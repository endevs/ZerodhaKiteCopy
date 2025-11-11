# Quick Start Guide

## 🚀 Get Started in 5 Minutes

### 1. Install Dependencies

**Backend:**
```bash
cd backend
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
```

**Frontend:**
```bash
cd frontend
npm install
```

### 2. Setup Environment

Create `backend/.env` file:
```env
SMTP_SERVER=smtp.gmail.com
USERNAME_EMAIL=your_email@gmail.com
PASSWORD_EMAIL=your_gmail_app_password
EMAIL_FROM=your_email@gmail.com
SECRET_KEY=generate_with_python_-c_"import_secrets;_print(secrets.token_hex(32))"
DATABASE_PATH=database.db
SERVER_HOST=0.0.0.0
SERVER_PORT=8000
DEBUG=False
CORS_ORIGINS=http://localhost:3000
```

### 3. Initialize Database

```bash
cd backend
python database.py
```

### 4. Start Servers

**Terminal 1 - Backend:**
```bash
cd backend
python app.py
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm start
```

### 5. Access Application

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

## ✅ Verification Checklist

- [ ] Backend server running on port 8000
- [ ] Frontend server running on port 3000
- [ ] Database initialized
- [ ] Can register new user
- [ ] Can login with OTP
- [ ] Can connect to Zerodha
- [ ] Dashboard loads with market data
- [ ] Can create and save strategy

## 🔧 Troubleshooting

**Issue: Module not found**
- Ensure virtual environment is activated
- Run `pip install -r requirements.txt` again

**Issue: Port already in use**
- Change `SERVER_PORT` in `.env` file
- Or kill process using the port

**Issue: CORS errors**
- Ensure `CORS_ORIGINS` in `.env` matches frontend URL
- Restart backend after changing `.env`

**Issue: Database errors**
- Run `python database.py` to recreate tables
- Check `DATABASE_PATH` in `.env`

