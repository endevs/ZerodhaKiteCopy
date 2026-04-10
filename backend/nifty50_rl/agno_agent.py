"""
Agno Agentic AI integration for pattern analysis and reasoning
"""
import logging
from typing import Dict, Any, List, Optional
# Import config from local nifty50_rl package
import sys
import os
import importlib.util
_current_dir = os.path.dirname(os.path.abspath(__file__))
_config_path = os.path.join(_current_dir, 'config.py')
spec = importlib.util.spec_from_file_location("nifty50_rl_config", _config_path)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)

logger = logging.getLogger(__name__)


class NiftyAgnoAgent:
    """
    Agno multimodal agent for reasoning and pattern analysis.
    Uses Ollama LLM3.2 for natural language reasoning.
    """
    
    def __init__(self, llm_model: str = config.AGNO_LLM_MODEL):
        self.llm_model = llm_model
        self.reasoning_enabled = config.AGNO_REASONING_ENABLED
        
        if self.reasoning_enabled:
            try:
                import ollama
                self.ollama_client = ollama
                logger.info(f"[Agno] Initialized with Ollama model: {llm_model}")
            except ImportError:
                logger.warning("[Agno] Ollama not available, using mock reasoning")
                self.reasoning_enabled = False
                self.ollama_client = None
        else:
            self.ollama_client = None
            logger.info("[Agno] Reasoning disabled, using mock analysis")
    
    def analyze_chart_pattern(self, state: Dict[str, Any], indicators: Dict[str, float]) -> str:
        """
        Analyze current chart pattern and generate natural language description.
        
        Args:
            state: Current market state
            indicators: Technical indicators (RSI, EMA, etc.)
        
        Returns:
            Natural language description of chart pattern
        """
        if not self.reasoning_enabled:
            return self._mock_analysis(state, indicators)
        
        try:
            prompt = self._build_analysis_prompt(state, indicators)
            response = self.ollama_client.generate(
                model=self.llm_model,
                prompt=prompt
            )
            return response.get('response', self._mock_analysis(state, indicators))
        except Exception as e:
            logger.warning(f"[Agno] Analysis failed, using mock: {e}")
            return self._mock_analysis(state, indicators)
    
    def validate_rl_decision(self, rl_action: int, analysis: str) -> bool:
        """
        Cross-validate RL decision with reasoning.
        
        Args:
            rl_action: Action chosen by RL agent (0-3)
            analysis: Chart pattern analysis
        
        Returns:
            True if decision is validated, False otherwise
        """
        # Simple validation: if analysis suggests bullish and RL says BUY, validate
        action_names = {0: 'HOLD', 1: 'BUY', 2: 'SELL', 3: 'CLOSE'}
        analysis_lower = analysis.lower()
        
        if rl_action == 1:  # BUY
            bullish_keywords = ['bullish', 'uptrend', 'above', 'buy', 'entry', 'long']
            return any(keyword in analysis_lower for keyword in bullish_keywords)
        elif rl_action == 2:  # SELL
            bearish_keywords = ['bearish', 'downtrend', 'below', 'sell', 'exit', 'overbought']
            return any(keyword in analysis_lower for keyword in bearish_keywords)
        
        return True  # HOLD and CLOSE are always valid
    
    def generate_strategy_summary(self, trades: List[Dict], patterns: List[Dict]) -> str:
        """
        Generate natural language summary of identified patterns and strategies.
        
        Args:
            trades: List of executed trades
            patterns: Identified trading patterns
        
        Returns:
            Natural language strategy summary
        """
        if not trades:
            return "No trades executed. Strategy needs more data to identify patterns."
        
        winning_trades = [t for t in trades if t.get('pnl', 0) > 0]
        win_rate = (len(winning_trades) / len(trades) * 100) if trades else 0
        
        summary = f"Strategy Analysis:\n"
        summary += f"- Total Trades: {len(trades)}\n"
        summary += f"- Win Rate: {win_rate:.1f}%\n"
        
        if patterns:
            summary += f"- Patterns Identified: {len(patterns)}\n"
            for i, pattern in enumerate(patterns[:3], 1):
                summary += f"  {i}. {pattern.get('description', 'Pattern')}\n"
        
        return summary
    
    def identify_patterns(self, price_data: Any, indicators: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Detect chart patterns from price data and indicators.
        
        Args:
            price_data: Price history
            indicators: Technical indicators
        
        Returns:
            List of identified patterns
        """
        patterns = []
        
        # Simple pattern detection (can be enhanced)
        if 'rsi' in indicators:
            rsi = indicators['rsi']
            if rsi > 70:
                patterns.append({
                    'type': 'overbought',
                    'description': 'RSI indicates overbought condition (>70)',
                    'signal': 'bearish'
                })
            elif rsi < 30:
                patterns.append({
                    'type': 'oversold',
                    'description': 'RSI indicates oversold condition (<30)',
                    'signal': 'bullish'
                })
        
        if 'ema50' in indicators and 'ema200' in indicators:
            ema50 = indicators['ema50']
            ema200 = indicators['ema200']
            if ema50 > ema200:
                patterns.append({
                    'type': 'golden_cross',
                    'description': 'EMA50 above EMA200 (bullish trend)',
                    'signal': 'bullish'
                })
            else:
                patterns.append({
                    'type': 'death_cross',
                    'description': 'EMA50 below EMA200 (bearish trend)',
                    'signal': 'bearish'
                })
        
        return patterns
    
    def _build_analysis_prompt(self, state: Dict, indicators: Dict) -> str:
        """Build prompt for LLM analysis."""
        prompt = f"""Analyze the current Bank Nifty market condition:

Price: {state.get('price', 'N/A')}
RSI: {indicators.get('rsi', 'N/A')}
EMA50: {indicators.get('ema50', 'N/A')}
EMA200: {indicators.get('ema200', 'N/A')}

Provide a brief technical analysis (1-2 sentences) of the current chart pattern and market condition.
"""
        return prompt
    
    def _mock_analysis(self, state: Dict, indicators: Dict) -> str:
        """Mock analysis when LLM is not available."""
        rsi = indicators.get('rsi', 50)
        price = state.get('price', 0)
        ema50 = indicators.get('ema50', price)
        
        if rsi > 70:
            return "Price is overbought with RSI above 70. Consider exit or wait for pullback."
        elif rsi < 30:
            return "Price is oversold with RSI below 30. Potential buying opportunity."
        elif price > ema50:
            return "Price is above EMA50, indicating bullish momentum. RL suggests entry."
        else:
            return "Price is below EMA50, indicating bearish momentum. RL suggests caution."


def evaluate_with_agno(
    env: Any,
    agent: Any,
    agno_agent: NiftyAgnoAgent,
    policy: str = 'deterministic'
) -> Dict[str, Any]:
    """
    Evaluate agent with Agno reasoning layer.
    
    Args:
        env: Trading environment
        agent: DQN agent
        agno_agent: Agno agent for reasoning
        policy: Policy to use
    
    Returns:
        Evaluation results with Agno analysis
    """
    from evaluator import evaluate_agent
    
    # Run standard evaluation
    results = evaluate_agent(env, agent, policy=policy)
    
    # Add Agno analysis
    if results.get('trade_history'):
        # Analyze patterns from trades
        patterns = agno_agent.identify_patterns(None, {})
        summary = agno_agent.generate_strategy_summary(
            results['trade_history'],
            patterns
        )
        results['agno_analysis'] = {
            'patterns': patterns,
            'summary': summary
        }
    
    return results

