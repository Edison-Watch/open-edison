"""
Python -m entrypoint for Open Edison.

Allows: python -m src to behave like `open-edison`.
"""

from .cli import main

if __name__ == "__main__":
    main()
