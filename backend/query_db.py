
import sqlite3

def query_database():
    db_path = 'database.db'
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        print("--- Tables in the database ---")
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = cursor.fetchall()
        for table in tables:
            print(table[0])
            
        print("\n--- Schema of the 'users' table ---")
        cursor.execute("PRAGMA table_info(users);")
        schema = cursor.fetchall()
        for column in schema:
            print(column)
            
        print("\n--- Data in the 'users' table ---")
        cursor.execute("SELECT * FROM users;")
        rows = cursor.fetchall()
        if not rows:
            print("No data found in the 'users' table.")
        for row in rows:
            print(row)
            
    except sqlite3.Error as e:
        print(f"An error occurred: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    query_database()
