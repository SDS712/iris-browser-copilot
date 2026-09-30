"""Prices for everything the backend pays for."""

from dataclasses import dataclass

VOICE_USD_PER_SECOND = 4.50 / 3600


@dataclass(frozen=True)
class ModelPrice:
    input_per_million: float
    output_per_million: float


MODEL_PRICES: dict[str, ModelPrice] = {
    "claude-sonnet-5": ModelPrice(3.0, 15.0),
    "claude-sonnet-4-6": ModelPrice(3.0, 15.0),
    "claude-haiku-4-5-20251001": ModelPrice(1.0, 5.0),
}


def model_price(model: str) -> ModelPrice | None:
    """None for an unknown model, which callers must treat as 'refuse the call'."""
    return MODEL_PRICES.get(model)


# Anthropic charges cache writes at 1.25× (5-minute) or 2× (1-hour) the input price.
CACHE_WRITE_5M_FACTOR = 1.25
CACHE_WRITE_1H_FACTOR = 2.0


def llm_cost_usd(
    price: ModelPrice,
    input_tokens: int,
    completion_tokens: int,
    cache_write_5m: int = 0,
    cache_write_1h: int = 0,
) -> float:
    """input_tokens includes cache reads, charged at the full input price to stay safe."""
    weighted_input = (
        input_tokens
        + cache_write_5m * CACHE_WRITE_5M_FACTOR
        + cache_write_1h * CACHE_WRITE_1H_FACTOR
    )
    return (
        weighted_input * price.input_per_million + completion_tokens * price.output_per_million
    ) / 1_000_000


def voice_cost_usd(seconds: float) -> float:
    return max(seconds, 0.0) * VOICE_USD_PER_SECOND
