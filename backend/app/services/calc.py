"""Loan maths. Pure functions: every figure Iris states comes from here."""

from dataclasses import dataclass

from app.errors import ErrorCode, IrisError
from app.schemas.common import RateBasis

MIN_PRINCIPAL = 1_000
MAX_PRINCIPAL = 1_00_00_000
MAX_TENURE = 120


@dataclass(frozen=True)
class LoanInput:
    principal: float
    rate_percent: float
    rate_basis: RateBasis
    tenure_months: int
    processing_fee_inr: float | None = None
    processing_fee_percent: float | None = None
    gst_percent_on_fee: float | None = None


@dataclass(frozen=True)
class LoanResult:
    interest: float
    emi: float
    total_paid: float
    fee: float
    gst: float
    upfront: float
    net_received: float
    extra_over_price: float
    monthly_rate: float
    apr_percent: float
    effective_annual_percent: float


def validate(loan: LoanInput) -> None:
    problems = []
    if not MIN_PRINCIPAL <= loan.principal <= MAX_PRINCIPAL:
        problems.append("the loan amount must be between ₹1,000 and ₹1,00,00,000")
    if not 1 <= loan.tenure_months <= MAX_TENURE:
        problems.append("the number of months must be between 1 and 120")
    rate_limit = 10 if loan.rate_basis == "flat_monthly" else 100
    if not 0 <= loan.rate_percent <= rate_limit:
        problems.append(f"the rate must be between 0 and {rate_limit}%")
    if problems:
        detail = "; ".join(problems)
        raise IrisError(
            ErrorCode.INVALID_REQUEST,
            f"Those loan details don't look right: {detail}.",
            agent_message=f"Those loan details don't look right: {detail}. "
            "Ask the user to check the numbers.",
        )


def interest_and_emi(
    principal: float, rate: float, basis: RateBasis, months: int
) -> tuple[float, float]:
    if basis == "flat_monthly":
        interest = principal * (rate / 100) * months
        return interest, (principal + interest) / months
    if basis == "flat_annual":
        interest = principal * (rate / 100 / 12) * months
        return interest, (principal + interest) / months
    monthly = rate / 100 / 12
    if monthly == 0:
        emi = principal / months
    else:
        growth = (1 + monthly) ** months
        emi = principal * monthly * growth / (growth - 1)
    return emi * months - principal, emi


def upfront_fees(loan: LoanInput) -> tuple[float, float, float]:
    """(fee, GST on it, upfront total rounded to the rupee)."""
    if loan.processing_fee_inr is not None:
        fee = loan.processing_fee_inr
    elif loan.processing_fee_percent is not None:
        fee = loan.principal * loan.processing_fee_percent / 100
    else:
        fee = 0.0
    gst = fee * (loan.gst_percent_on_fee or 0) / 100
    return fee, gst, float(round(fee + gst))


def monthly_irr(net: float, emi: float, months: int) -> float:
    """The monthly rate m where net = EMI × (1 − (1 + m)^−n) / m, by bisection."""

    def present_value(rate: float) -> float:
        return float(emi * (1 - (1 + rate) ** -months) / rate)

    low, high = 1e-9, 1.0
    if present_value(low) <= net:
        return 0.0
    for _ in range(200):
        middle = (low + high) / 2
        if present_value(middle) > net:
            low = middle
        else:
            high = middle
    return (low + high) / 2


def calculate(loan: LoanInput) -> LoanResult:
    validate(loan)
    interest, emi = interest_and_emi(
        loan.principal, loan.rate_percent, loan.rate_basis, loan.tenure_months
    )
    total_paid = emi * loan.tenure_months
    fee, gst, upfront = upfront_fees(loan)
    # Net received is the same whether the fee is deducted or paid separately at the start.
    net = loan.principal - upfront
    monthly = monthly_irr(net, emi, loan.tenure_months)
    return LoanResult(
        interest=round(interest, 2),
        emi=round(emi, 2),
        total_paid=round(total_paid, 2),
        fee=round(fee, 2),
        gst=round(gst, 2),
        upfront=upfront,
        net_received=round(net, 2),
        extra_over_price=round(total_paid + upfront - loan.principal, 2),
        monthly_rate=monthly,
        apr_percent=round(monthly * 12 * 100, 2),
        effective_annual_percent=round(((1 + monthly) ** 12 - 1) * 100, 2),
    )
