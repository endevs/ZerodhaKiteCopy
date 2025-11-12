import subprocess
import sys


def check_gpu():
    # Check if GPU is available
    try:
        import torch
        if torch.cuda.is_available():
            print("\nGPU is available!")
            print(f"GPU Device Name: {torch.cuda.get_device_name(0)}")
            print(f"CUDA Version: {torch.version.cuda}")
            print(f"Total GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1024 ** 3:.2f} GB")
        else:
            print("\nNo GPU available (using CPU)")
    except ImportError:
        print("PyTorch is not installed. Trying alternative methods...")

    # Alternative method using nvidia-smi
    try:
        result = subprocess.run(['nvidia-smi'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode == 0:
            print("\nFound NVIDIA GPU information:")
            print(result.stdout.split('\n')[0])  # Driver version
            print(result.stdout.split('\n')[9])  # GPU name and memory info
        else:
            print("\nNo NVIDIA GPU detected (nvidia-smi not available)")
    except FileNotFoundError:
        print("\n'nvidia-smi' command not found - likely no NVIDIA GPU installed")



if __name__ == "__main__":
    print("Checking GPU information...")
    check_gpu()

    # Additional system info
    print("\nSystem information:")
    print(f"Python version: {sys.version}")
    print(f"Operating System: {sys.platform}")