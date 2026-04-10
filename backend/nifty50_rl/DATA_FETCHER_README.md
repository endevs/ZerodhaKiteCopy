# Nifty 50 Data Fetcher Utility

This utility fetches and caches Nifty 50 futures data month-by-month with volume data.

## Features

- ✅ Fetches 5-minute OHLC data with volume from Nifty futures contracts
- ✅ Caches data month-by-month in CSV files for reuse
- ✅ Automatically checks cache before fetching
- ✅ Fetches only missing months
- ✅ Stores metadata about cached data
- ✅ Main RL system automatically uses cached data

## Directory Structure

```
backend/nifty50_rl/
├── data/                          # Cached data directory
│   ├── nifty50_futures_2025_01.csv
│   ├── nifty50_futures_2025_02.csv
│   ├── ...
│   └── metadata.json              # Metadata about cached data
├── logs/                          # Log files
│   └── data_fetcher_utility_*.log
├── data_fetcher_utility.py        # Standalone data fetcher
└── data_fetcher.py                 # Updated to use cache
```

## Usage

### 1. First Time Setup - Fetch 1 Year of Data

```bash
cd backend/nifty50_rl
python data_fetcher_utility.py --months 12
```

This will:
- Fetch data for the last 12 months
- Store each month in a separate CSV file
- Create metadata.json with information about cached data

### 2. Update Recent Data (Run Periodically)

```bash
python data_fetcher_utility.py --update
```

This updates the last 3 months of data (useful for keeping recent data fresh).

### 3. Fetch Specific Date Range

```bash
python data_fetcher_utility.py --start-date 2025-01-01 --end-date 2025-12-31
```

### 4. Force Refresh (Re-fetch Even If Cached)

```bash
python data_fetcher_utility.py --months 12 --force-refresh
```

## Command Line Options

- `--start-date YYYY-MM-DD`: Start date for data fetch
- `--end-date YYYY-MM-DD`: End date for data fetch
- `--months N`: Fetch last N months from today
- `--update`: Update recent months only (last 3 months)
- `--force-refresh`: Re-fetch even if data is already cached
- `--user-email EMAIL`: User email for Zerodha credentials (default: raj.bapa@gmail.com)

## How It Works

1. **Month-by-Month Fetching**: The utility fetches data for each month separately, using the appropriate futures contract for that month.

2. **Caching**: Each month's data is stored as `nifty50_futures_YYYY_MM.csv` in the `data/` directory.

3. **Metadata**: The `metadata.json` file tracks:
   - Which months are cached
   - Number of candles per month
   - Date ranges for each month
   - When data was cached

4. **Automatic Cache Usage**: When you run `main.py`, it automatically:
   - Checks for cached data first
   - Uses cached data if available
   - Fetches missing months if needed
   - Falls back to direct fetch if cache is unavailable

## Integration with Main RL System

The `data_fetcher.py` module has been updated to automatically use cached data:

```python
# In main.py, this will now use cache automatically
raw_data = fetch_nifty50_data(
    kite_client, 
    start_date, 
    end_date,
    use_futures=True,  # Uses futures for volume
    use_cache=True     # Checks cache first (default: True)
)
```

## Benefits

1. **Faster Training**: No need to fetch data every time you train
2. **Volume Data**: Futures contracts provide volume data (index doesn't)
3. **Reliability**: Cached data is available even if Zerodha API is temporarily unavailable
4. **Efficiency**: Only fetches missing months
5. **Logging**: All operations are logged to files in `logs/` directory

## Logging

All operations are logged to:
- Console (stdout)
- Log file: `logs/data_fetcher_utility_YYYYMMDD_HHMMSS.log`
- Main RL logs: `logs/nifty50_rl_YYYYMMDD_HHMMSS.log`

## Troubleshooting

### No Data for Some Months

If you see "⚠ No data for chunk X", it might mean:
- The futures contract didn't exist for that month
- Market was closed (holidays)
- Data is not available from Zerodha for that period

### Cache Not Working

If cache is not being used:
1. Check if `data/` directory exists
2. Check if CSV files are present
3. Check `metadata.json` for cached months
4. Verify file permissions

### Volume Data Missing

If volume is 0 or missing:
- Ensure you're using futures (`use_futures=True`)
- Check if the futures contract has volume data
- Some older contracts may not have volume data

## Example Workflow

```bash
# Step 1: Fetch and cache 1 year of data
python data_fetcher_utility.py --months 12

# Step 2: Run RL training (will use cached data)
python main.py

# Step 3: Periodically update recent data
python data_fetcher_utility.py --update
```

## Notes

- Data is stored in CSV format for easy inspection
- Each month is stored separately for efficient updates
- The system automatically combines months when loading
- Duplicate timestamps are removed when combining data

