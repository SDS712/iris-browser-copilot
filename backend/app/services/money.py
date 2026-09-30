"""Rupee amounts: Indian digit grouping and parsing from page text."""

import re

# "₹1,299", "₹ 59,999", "Rs. 500", "INR 1,00,000.50"
RUPEE_RE = re.compile(r"(?:₹|\bRs\.?|\bINR)\s?(\d[\d,]*(?:\.\d+)?)", re.IGNORECASE)


def group_indian(whole: int) -> str:
    """1299 → '1,299'; 100000 → '1,00,000'."""
    digits = str(abs(whole))
    if len(digits) <= 3:
        grouped = digits
    else:
        head, tail = digits[:-3], digits[-3:]
        pairs: list[str] = []
        while len(head) > 2:
            pairs.insert(0, head[-2:])
            head = head[:-2]
        if head:
            pairs.insert(0, head)
        grouped = ",".join([*pairs, tail])
    return f"-{grouped}" if whole < 0 else grouped


def format_inr(amount: float, *, paise: bool = False) -> str:
    """₹ with Indian grouping. Whole amounts show no decimals unless paise=True."""
    rounded = round(amount, 2)
    whole = int(rounded)
    fraction = round(abs(rounded - whole) * 100)
    if paise or fraction:
        return f"₹{group_indian(whole)}.{fraction:02d}"
    return f"₹{group_indian(whole)}"


def number_value(amount: float) -> int | float:
    """Whole numbers as int so they stay integers on the wire."""
    return int(amount) if float(amount).is_integer() else amount


def parse_amount(text: str) -> float | None:
    try:
        return float(text.replace(",", ""))
    except ValueError:
        return None


def rupee_amounts(text: str) -> list[float]:
    """Every rupee amount written in the text, in order."""
    amounts = []
    for match in RUPEE_RE.finditer(text):
        value = parse_amount(match.group(1))
        if value is not None:
            amounts.append(value)
    return amounts


def first_rupee_amount(text: str | None) -> int | float | None:
    if not text:
        return None
    amounts = rupee_amounts(text)
    return number_value(amounts[0]) if amounts else None
