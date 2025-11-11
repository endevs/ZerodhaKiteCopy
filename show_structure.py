# simple_structure.py
import os
from pathlib import Path


def show_top_folders(start_path=".", ignore=None):
    """Show only top-level folders"""
    if ignore is None:
        ignore = {'.git', '__pycache__', '.idea', 'venv', '.venv', 'node_modules'}

    start_path = Path(start_path).resolve()
    print(f"📁 {os.path.basename(start_path)}/")

    try:
        items = sorted(os.listdir(start_path))
        folders = [item for item in items
                   if os.path.isdir(os.path.join(start_path, item)) and item not in ignore]

        for folder in folders:
            print(f"  📂 {folder}/")

    except Exception as e:
        print(f"  Error: {e}")


if __name__ == '__main__':
    show_top_folders()