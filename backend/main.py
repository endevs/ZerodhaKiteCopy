from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from kiteconnect import KiteConnect
import logging
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)

# In a real application, you would use a more secure way to store API keys
# and secrets, like environment variables or a secrets management service.
API_KEY = "05r0pzfiso76mmaf"  # Replace with your Zerodha API key
API_SECRET = "0zs2510jnqwnxxgh47cbeelws6zv9vth"  # Replace with your Zerodha API secret

app = FastAPI()

# In-memory session storage (for demonstration purposes)
# In a production environment, you would use a more robust session management
# solution, like a database or a Redis cache.
user_sessions = {}

# Initialize KiteConnect
kite = KiteConnect(api_key=API_KEY)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In a production environment, you should restrict this to your frontend's domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Strategy(BaseModel):
    strategy: str
    candle: str
    index: str
    startTime: str
    targetProfit: int
    stopLoss: int
    quantity: int

trade_active = False

@app.get("/")
def read_root():
    return {"message": "Welcome to the Zerodha Trading Platform API"}

@app.get("/api/zerodha/login")
def zerodha_login():
    """
    Redirects the user to the Zerodha login page to get a request token.
    """
    # The login URL will redirect to our /api/zerodha/callback endpoint
    login_url = kite.login_url()
    return RedirectResponse(url=login_url)

@app.get("/api/zerodha/callback")
def zerodha_callback(request: Request):
    """
    Handles the callback from Zerodha after a successful login.
    Generates an access token and stores it in the user's session.
    """
    request_token = request.query_params.get("request_token")
    if not request_token:
        return {"status": "error", "message": "Request token not found"}

    try:
        # Generate an access token using the request token
        data = kite.generate_session(request_token, api_secret=API_SECRET)
        access_token = data["access_token"]

        # Store the access token in the user's session
        # We'll use a simple user ID for this example
        user_id = "user123"  # In a real app, you'd have a proper user ID
        user_sessions[user_id] = {"access_token": access_token}

        # Set the access token for the KiteConnect instance
        kite.set_access_token(access_token)

        # Redirect the user to the frontend dashboard
        return RedirectResponse(url="http://localhost:3000/dashboard")

    except Exception as e:
        logging.error(f"Error generating session: {e}")
        return {"status": "error", "message": "Could not generate session"}

@app.get("/api/user/profile")
def get_user_profile():
    """
    Fetches the user's profile and margin information from Zerodha.
    """
    user_id = "user123"  # In a real app, you'd get the user ID from the session
    if user_id not in user_sessions:
        return {"status": "error", "message": "User not logged in"}

    try:
        # Set the access token for the KiteConnect instance
        kite.set_access_token(user_sessions[user_id]["access_token"])

        # Fetch the user's profile and margins
        profile = kite.profile()
        margins = kite.margins()

        # Combine the profile and margins into a single response
        # The frontend expects a specific structure
        combined_profile = {
            "user_name": profile.get("user_name"),
            "equity": {
                "available": {
                    "margin": margins.get("equity", {}).get("available", {}).get("live_balance")
                }
            }
        }
        return combined_profile

    except Exception as e:
        logging.error(f"Error fetching profile: {e}")
        return {"status": "error", "message": "Could not fetch profile"}

@app.post("/api/strategy/start")
def start_strategy(strategy: Strategy):
    global trade_active
    logging.info(f"Starting strategy: {strategy.dict()}")
    trade_active = True
    return {"status": "success"}

@app.post("/api/strategy/stop")
def stop_strategy():
    global trade_active
    logging.info("Stopping strategy")
    trade_active = False
    return {"status": "success"}

@app.post("/api/trade/squareoff")
def square_off():
    global trade_active
    logging.info("Squaring off trade")
    trade_active = False
    return {"status": "success"}

@app.get("/api/trade/pnl")
def get_pnl():
    global trade_active
    if trade_active:
        # In a real application, you would calculate the actual P&L
        import random
        pnl = random.randint(-1000, 1000)
        return {"pnl": pnl}
    return {"pnl": 0}
