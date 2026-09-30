"""Loan maths: four worked cases, to the cent, and validation."""

import pytest

from app.errors import IrisError
from app.services.calc import LoanInput, calculate, monthly_irr

CASES = [
    (
        LoanInput(59999, 1.5, "flat_monthly", 12, processing_fee_percent=2, gst_percent_on_fee=18),
        (10799.82, 5899.90, 70798.82, 12215.82, 36.50, 43.26, 1416),
    ),
    (
        LoanInput(59999, 1.5, "flat_monthly", 12),
        (10799.82, 5899.90, 70798.82, 10799.82, 31.72, 36.76, 0),
    ),
    (
        LoanInput(100000, 1, "flat_monthly", 24),
        (24000.00, 5166.67, 124000.00, 24000.00, 21.57, 23.84, 0),
    ),
    (
        LoanInput(50000, 2, "flat_monthly", 6, processing_fee_inr=1000),
        (6000.00, 9333.33, 56000.00, 7000.00, 47.45, 59.26, 1000),
    ),
]


@pytest.mark.parametrize(("loan", "expected"), CASES)
def test_spec_table(loan: LoanInput, expected: tuple[float, ...]) -> None:
    interest, emi, total, extra, apr, effective, upfront = expected
    result = calculate(loan)
    assert result.interest == pytest.approx(interest, abs=0.005)
    assert result.emi == pytest.approx(emi, abs=0.005)
    assert result.total_paid == pytest.approx(total, abs=0.005)
    assert result.extra_over_price == pytest.approx(extra, abs=0.005)
    assert result.apr_percent == pytest.approx(apr, abs=0.005)
    assert result.effective_annual_percent == pytest.approx(effective, abs=0.005)
    assert result.upfront == upfront


def test_fee_given_in_rupees_is_used_as_is() -> None:
    result = calculate(LoanInput(59999, 1.5, "flat_monthly", 12, processing_fee_inr=1416))
    assert result.apr_percent == pytest.approx(36.50, abs=0.005)


def test_flat_annual_and_reducing() -> None:
    flat = calculate(LoanInput(100000, 12, "flat_annual", 12))
    assert flat.interest == pytest.approx(12000.0)
    reducing = calculate(LoanInput(100000, 12, "reducing_annual", 12))
    assert reducing.emi == pytest.approx(8884.88, abs=0.01)
    # With no fee, a reducing-balance APR is the advertised rate.
    assert reducing.apr_percent == pytest.approx(12.0, abs=0.01)


def test_zero_rate() -> None:
    result = calculate(LoanInput(12000, 0, "reducing_annual", 12))
    assert result.emi == 1000
    assert result.apr_percent == 0
    assert monthly_irr(12000, 1000, 12) == pytest.approx(0, abs=1e-6)


@pytest.mark.parametrize(
    "loan",
    [
        LoanInput(999, 1.5, "flat_monthly", 12),
        LoanInput(1_00_00_001, 1.5, "flat_monthly", 12),
        LoanInput(50000, 1.5, "flat_monthly", 0),
        LoanInput(50000, 1.5, "flat_monthly", 121),
        LoanInput(50000, 10.5, "flat_monthly", 12),
        LoanInput(50000, 101, "reducing_annual", 12),
        LoanInput(50000, -1, "flat_annual", 12),
    ],
)
def test_validation(loan: LoanInput) -> None:
    with pytest.raises(IrisError) as caught:
        calculate(loan)
    assert caught.value.code == "invalid_request"
    assert "Ask the user" in caught.value.agent_message
