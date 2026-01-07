"""
ProfitMaxi: Volume-Sensitive Limit Order Simulation
====================================================
Monte Carlo simulation proving the mathematical thesis for 
delta-ratio based order execution on AMM liquidity pools.

Author: Justin Liverman (d3f4ult) - Mezzanine DAO
"""

import numpy as np
import matplotlib.pyplot as plt
from dataclasses import dataclass, field
from typing import List, Tuple, Optional
import json
from scipy import stats


@dataclass
class AMMPool:
    """Constant Product Market Maker (x * y = k)"""
    token_reserve: float  # x - token amount (e.g., $DFLT)
    quote_reserve: float  # y - quote amount (e.g., SOL)
    
    @property
    def k(self) -> float:
        """Invariant constant"""
        return self.token_reserve * self.quote_reserve
    
    @property
    def price(self) -> float:
        """Current spot price (quote per token)"""
        return self.quote_reserve / self.token_reserve
    
    @property
    def liquidity(self) -> float:
        """Total liquidity in quote terms"""
        return self.quote_reserve * 2
    
    def buy_tokens(self, quote_amount: float) -> float:
        """
        Execute a buy order (swap quote for tokens)
        Returns: tokens received
        """
        if quote_amount <= 0:
            return 0
        
        new_quote = self.quote_reserve + quote_amount
        new_token = self.k / new_quote
        tokens_out = self.token_reserve - new_token
        
        self.quote_reserve = new_quote
        self.token_reserve = new_token
        
        return tokens_out
    
    def sell_tokens(self, token_amount: float) -> float:
        """
        Execute a sell order (swap tokens for quote)
        Returns: quote received
        """
        if token_amount <= 0:
            return 0
        
        new_token = self.token_reserve + token_amount
        new_quote = self.k / new_token
        quote_out = self.quote_reserve - new_quote
        
        self.token_reserve = new_token
        self.quote_reserve = new_quote
        
        return quote_out
    
    def quote_to_tokens(self, quote_amount: float) -> float:
        """Calculate tokens receivable for quote amount at current price"""
        return quote_amount / self.price
    
    def tokens_to_quote(self, token_amount: float) -> float:
        """Calculate quote receivable for token amount at current price"""
        return token_amount * self.price
    
    def copy(self) -> 'AMMPool':
        """Create a copy of current pool state"""
        return AMMPool(self.token_reserve, self.quote_reserve)


@dataclass
class ProfitMaxiOrder:
    """Volume-Sensitive Limit Order"""
    total_size: float          # Total order size in quote currency
    delta_ratio: float         # r ∈ (0, 1] - matching ratio
    min_threshold: float       # θ - minimum buy size to trigger
    remaining: float = None    # Remaining unfilled amount
    fills: List[dict] = field(default_factory=list)
    
    def __post_init__(self):
        if self.remaining is None:
            self.remaining = self.total_size
    
    @property
    def filled(self) -> float:
        return self.total_size - self.remaining
    
    @property
    def fill_percentage(self) -> float:
        return (self.filled / self.total_size) * 100
    
    @property
    def is_complete(self) -> bool:
        return self.remaining <= 0


@dataclass
class SimulationConfig:
    """Configuration for Monte Carlo simulation"""
    # Pool parameters
    initial_token_reserve: float = 1_000_000  # 1M tokens
    initial_quote_reserve: float = 1_000      # 1000 SOL (~$200k liquidity)
    
    # Order parameters  
    order_size: float = 100                   # 100 SOL total order
    delta_ratio: float = 1.0                  # r = 1 (price neutral)
    min_threshold: float = 0.1                # Minimum 0.1 SOL buy to trigger
    
    # Market dynamics (Poisson process)
    buy_arrival_rate: float = 10              # λ = 10 buys per time unit
    mean_buy_size: float = 2.0                # Average buy size in SOL
    buy_size_std: float = 1.5                 # Std dev of buy sizes
    
    # Simulation parameters
    max_time_steps: int = 1000                # Maximum simulation steps
    num_simulations: int = 1000               # Monte Carlo iterations
    
    # Optional: organic sell pressure (other sellers)
    organic_sell_rate: float = 0              # Additional sell pressure
    mean_organic_sell: float = 1.0


@dataclass 
class SimulationResult:
    """Results from a single simulation run"""
    final_price: float
    initial_price: float
    fill_time: int
    total_volume: float
    price_history: List[float]
    fill_history: List[float]
    order_fills: List[dict]
    
    @property
    def price_change_pct(self) -> float:
        return ((self.final_price - self.initial_price) / self.initial_price) * 100
    
    @property
    def was_filled(self) -> bool:
        return self.fill_history[-1] >= 99.99  # Account for floating point


class ProfitMaxiSimulator:
    """Monte Carlo simulator for ProfitMaxi orders"""
    
    def __init__(self, config: SimulationConfig):
        self.config = config
        self.rng = np.random.default_rng()
    
    def generate_buy_volume(self) -> float:
        """Generate a single buy order size (log-normal distribution)"""
        # Log-normal better models real market buy distributions
        size = self.rng.lognormal(
            mean=np.log(self.config.mean_buy_size),
            sigma=0.8
        )
        return max(0.01, size)  # Minimum dust amount
    
    def generate_num_buys(self) -> int:
        """Generate number of buys in a time step (Poisson)"""
        return self.rng.poisson(self.config.buy_arrival_rate)
    
    def run_single_simulation(self) -> SimulationResult:
        """Execute one complete simulation"""
        
        # Initialize pool
        pool = AMMPool(
            token_reserve=self.config.initial_token_reserve,
            quote_reserve=self.config.initial_quote_reserve
        )
        initial_price = pool.price
        
        # Initialize order
        order = ProfitMaxiOrder(
            total_size=self.config.order_size,
            delta_ratio=self.config.delta_ratio,
            min_threshold=self.config.min_threshold
        )
        
        # Tracking
        price_history = [initial_price]
        fill_history = [0.0]
        total_volume = 0
        
        # Simulation loop
        for t in range(self.config.max_time_steps):
            if order.is_complete:
                break
            
            # Generate buy orders for this time step
            num_buys = self.generate_num_buys()
            
            for _ in range(num_buys):
                buy_size = self.generate_buy_volume()
                total_volume += buy_size
                
                # Execute the buy
                tokens_bought = pool.buy_tokens(buy_size)
                
                # Check if triggers ProfitMaxi
                if buy_size >= order.min_threshold and not order.is_complete:
                    # Calculate sell amount based on delta ratio
                    sell_quote_value = min(
                        order.delta_ratio * buy_size,
                        order.remaining
                    )
                    
                    # Convert to tokens at current price
                    tokens_to_sell = pool.quote_to_tokens(sell_quote_value)
                    
                    # Execute the sell
                    quote_received = pool.sell_tokens(tokens_to_sell)
                    
                    # Update order
                    order.remaining -= sell_quote_value
                    order.fills.append({
                        'time': t,
                        'trigger_buy': buy_size,
                        'sell_amount': sell_quote_value,
                        'tokens_sold': tokens_to_sell,
                        'quote_received': quote_received,
                        'price_at_fill': pool.price
                    })
            
            # Optional: organic sell pressure
            if self.config.organic_sell_rate > 0:
                num_organic_sells = self.rng.poisson(self.config.organic_sell_rate)
                for _ in range(num_organic_sells):
                    organic_sell = self.rng.exponential(self.config.mean_organic_sell)
                    tokens_to_sell = pool.quote_to_tokens(organic_sell)
                    pool.sell_tokens(tokens_to_sell)
            
            price_history.append(pool.price)
            fill_history.append(order.fill_percentage)
        
        return SimulationResult(
            final_price=pool.price,
            initial_price=initial_price,
            fill_time=len(price_history) - 1,
            total_volume=total_volume,
            price_history=price_history,
            fill_history=fill_history,
            order_fills=order.fills
        )
    
    def run_monte_carlo(self, verbose: bool = True) -> List[SimulationResult]:
        """Run full Monte Carlo simulation"""
        results = []
        
        for i in range(self.config.num_simulations):
            result = self.run_single_simulation()
            results.append(result)
            
            if verbose and (i + 1) % 100 == 0:
                print(f"Completed {i + 1}/{self.config.num_simulations} simulations")
        
        return results
    
    def analyze_results(self, results: List[SimulationResult]) -> dict:
        """Statistical analysis of simulation results"""
        
        price_changes = [r.price_change_pct for r in results]
        fill_times = [r.fill_time for r in results]
        fill_rates = [r.fill_history[-1] for r in results]
        
        analysis = {
            'config': {
                'delta_ratio': self.config.delta_ratio,
                'order_size': self.config.order_size,
                'pool_liquidity': self.config.initial_quote_reserve * 2,
                'order_to_liquidity_ratio': self.config.order_size / (self.config.initial_quote_reserve * 2),
                'num_simulations': self.config.num_simulations
            },
            'price_impact': {
                'mean_pct': np.mean(price_changes),
                'std_pct': np.std(price_changes),
                'median_pct': np.median(price_changes),
                'min_pct': np.min(price_changes),
                'max_pct': np.max(price_changes),
                'ci_95': stats.t.interval(0.95, len(price_changes)-1, 
                                          loc=np.mean(price_changes), 
                                          scale=stats.sem(price_changes))
            },
            'fill_time': {
                'mean': np.mean(fill_times),
                'std': np.std(fill_times),
                'median': np.median(fill_times),
                'min': np.min(fill_times),
                'max': np.max(fill_times)
            },
            'fill_rate': {
                'mean_pct': np.mean(fill_rates),
                'fully_filled_pct': sum(1 for r in results if r.was_filled) / len(results) * 100
            }
        }
        
        return analysis


def compare_delta_ratios(base_config: SimulationConfig, 
                         ratios: List[float] = [0.3, 0.5, 0.8, 1.0],
                         num_sims: int = 500) -> dict:
    """Compare different delta ratios"""
    
    comparisons = {}
    
    for r in ratios:
        print(f"\n{'='*50}")
        print(f"Running simulations for delta_ratio = {r}")
        print('='*50)
        
        config = SimulationConfig(
            initial_token_reserve=base_config.initial_token_reserve,
            initial_quote_reserve=base_config.initial_quote_reserve,
            order_size=base_config.order_size,
            delta_ratio=r,
            min_threshold=base_config.min_threshold,
            buy_arrival_rate=base_config.buy_arrival_rate,
            mean_buy_size=base_config.mean_buy_size,
            num_simulations=num_sims
        )
        
        simulator = ProfitMaxiSimulator(config)
        results = simulator.run_monte_carlo(verbose=True)
        analysis = simulator.analyze_results(results)
        
        comparisons[r] = {
            'analysis': analysis,
            'results': results
        }
        
        print(f"\nResults for r = {r}:")
        print(f"  Mean price change: {analysis['price_impact']['mean_pct']:.4f}%")
        print(f"  Price change std:  {analysis['price_impact']['std_pct']:.4f}%")
        print(f"  Mean fill time:    {analysis['fill_time']['mean']:.1f} steps")
        print(f"  Fill success rate: {analysis['fill_rate']['fully_filled_pct']:.1f}%")
    
    return comparisons


def plot_comparison(comparisons: dict, save_path: str = None):
    """Generate visualization of delta ratio comparison"""
    
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle('ProfitMaxi: Delta Ratio Comparison Analysis', fontsize=14, fontweight='bold')
    
    ratios = sorted(comparisons.keys())
    colors = plt.cm.viridis(np.linspace(0.2, 0.8, len(ratios)))
    
    # Plot 1: Price Impact Distribution
    ax1 = axes[0, 0]
    for i, r in enumerate(ratios):
        price_changes = [res.price_change_pct for res in comparisons[r]['results']]
        ax1.hist(price_changes, bins=50, alpha=0.6, label=f'r = {r}', color=colors[i])
    ax1.axvline(x=0, color='red', linestyle='--', alpha=0.7, label='Zero impact')
    ax1.set_xlabel('Price Change (%)')
    ax1.set_ylabel('Frequency')
    ax1.set_title('Price Impact Distribution by Delta Ratio')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    
    # Plot 2: Mean Price Impact vs Delta Ratio
    ax2 = axes[0, 1]
    means = [comparisons[r]['analysis']['price_impact']['mean_pct'] for r in ratios]
    stds = [comparisons[r]['analysis']['price_impact']['std_pct'] for r in ratios]
    ax2.errorbar(ratios, means, yerr=stds, marker='o', capsize=5, capthick=2, 
                 linewidth=2, markersize=10, color='blue')
    ax2.axhline(y=0, color='red', linestyle='--', alpha=0.7)
    ax2.fill_between(ratios, 
                     [m - s for m, s in zip(means, stds)],
                     [m + s for m, s in zip(means, stds)],
                     alpha=0.2, color='blue')
    ax2.set_xlabel('Delta Ratio (r)')
    ax2.set_ylabel('Mean Price Change (%)')
    ax2.set_title('Price Impact vs Delta Ratio')
    ax2.grid(True, alpha=0.3)
    
    # Theoretical line
    theoretical = [(1 - r) * 10 for r in ratios]  # Simplified theoretical prediction
    ax2.plot(ratios, theoretical, '--', color='green', alpha=0.7, label='Theoretical (scaled)')
    ax2.legend()
    
    # Plot 3: Fill Time Distribution
    ax3 = axes[1, 0]
    fill_times_data = [[res.fill_time for res in comparisons[r]['results']] for r in ratios]
    bp = ax3.boxplot(fill_times_data, labels=[f'r={r}' for r in ratios], patch_artist=True)
    for patch, color in zip(bp['boxes'], colors):
        patch.set_facecolor(color)
        patch.set_alpha(0.6)
    ax3.set_xlabel('Delta Ratio')
    ax3.set_ylabel('Fill Time (steps)')
    ax3.set_title('Fill Time Distribution by Delta Ratio')
    ax3.grid(True, alpha=0.3)
    
    # Plot 4: Sample Price Trajectory
    ax4 = axes[1, 1]
    for i, r in enumerate(ratios):
        # Pick median-performing simulation
        results = comparisons[r]['results']
        price_changes = [res.price_change_pct for res in results]
        median_idx = np.argsort(price_changes)[len(price_changes)//2]
        sample = results[median_idx]
        
        # Normalize to percentage change
        normalized = [(p / sample.initial_price - 1) * 100 for p in sample.price_history]
        ax4.plot(normalized, label=f'r = {r}', color=colors[i], alpha=0.8)
    
    ax4.axhline(y=0, color='red', linestyle='--', alpha=0.5)
    ax4.set_xlabel('Time Step')
    ax4.set_ylabel('Price Change from Initial (%)')
    ax4.set_title('Sample Price Trajectories (Median Outcome)')
    ax4.legend()
    ax4.grid(True, alpha=0.3)
    
    plt.tight_layout()
    
    if save_path:
        plt.savefig(save_path, dpi=150, bbox_inches='tight')
        print(f"\nPlot saved to: {save_path}")
    
    return fig


def run_full_analysis():
    """Run complete analysis suite"""
    
    print("="*60)
    print("PROFITMAXI SIMULATION: VOLUME-SENSITIVE LIMIT ORDER")
    print("="*60)
    print("\nInitializing simulation parameters...")
    
    # Base configuration matching realistic Solana memecoin scenario
    base_config = SimulationConfig(
        initial_token_reserve=1_000_000_000,  # 1B token supply in pool
        initial_quote_reserve=500,             # 500 SOL (~$100k liquidity)
        order_size=50,                         # 50 SOL position to exit (~$10k)
        min_threshold=0.05,                    # Min 0.05 SOL buy to trigger
        buy_arrival_rate=5,                    # 5 buys per time unit avg
        mean_buy_size=0.5,                     # Average 0.5 SOL buy
        num_simulations=500
    )
    
    print(f"\nScenario: Exiting {base_config.order_size} SOL position")
    print(f"Pool liquidity: {base_config.initial_quote_reserve * 2} SOL")
    print(f"Order/Liquidity ratio: {base_config.order_size / (base_config.initial_quote_reserve * 2) * 100:.1f}%")
    
    # Compare delta ratios
    ratios_to_test = [0.3, 0.5, 0.8, 1.0]
    comparisons = compare_delta_ratios(base_config, ratios_to_test, num_sims=500)
    
    # Generate visualization
    fig = plot_comparison(comparisons, save_path='/home/claude/profitmaxi/analysis_results.png')
    
    # Summary statistics
    print("\n" + "="*60)
    print("SUMMARY: THEORETICAL vs EMPIRICAL VALIDATION")
    print("="*60)
    
    print("\n{:<12} {:<18} {:<18} {:<15}".format(
        "Delta (r)", "Mean Δ Price (%)", "Theoretical Δ", "Fill Time"
    ))
    print("-" * 65)
    
    for r in ratios_to_test:
        analysis = comparisons[r]['analysis']
        empirical = analysis['price_impact']['mean_pct']
        
        # Theoretical: (1-r) * (order_size / liquidity) * scaling_factor
        order_liq_ratio = base_config.order_size / (base_config.initial_quote_reserve * 2)
        theoretical = (1 - r) * order_liq_ratio * 100 * 2  # Rough scaling
        
        fill_time = analysis['fill_time']['mean']
        
        print(f"{r:<12} {empirical:<18.4f} {theoretical:<18.4f} {fill_time:<15.1f}")
    
    # Save detailed results
    results_summary = {
        'config': {
            'initial_token_reserve': base_config.initial_token_reserve,
            'initial_quote_reserve': base_config.initial_quote_reserve,
            'order_size': base_config.order_size,
            'order_to_liquidity_pct': base_config.order_size / (base_config.initial_quote_reserve * 2) * 100,
            'buy_arrival_rate': base_config.buy_arrival_rate,
            'mean_buy_size': base_config.mean_buy_size,
            'num_simulations': base_config.num_simulations
        },
        'results_by_delta_ratio': {}
    }
    
    for r in ratios_to_test:
        results_summary['results_by_delta_ratio'][str(r)] = comparisons[r]['analysis']
    
    with open('/home/claude/profitmaxi/results_summary.json', 'w') as f:
        json.dump(results_summary, f, indent=2, default=str)
    
    print(f"\n✓ Detailed results saved to: /home/claude/profitmaxi/results_summary.json")
    print(f"✓ Visualization saved to: /home/claude/profitmaxi/analysis_results.png")
    
    return comparisons, results_summary


if __name__ == "__main__":
    comparisons, summary = run_full_analysis()
