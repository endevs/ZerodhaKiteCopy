"""
Subscription management routes (non-payment related).
"""
import logging
from flask import request, jsonify, session
from subscription_manager import (
    create_subscription,
    get_user_subscription_info,
    check_feature_access
)

def register_subscription_routes(app):
    """Register subscription management routes."""
    
    @app.route("/api/subscription/activate-freemium", methods=['POST'])
    def api_activate_freemium():
        """Activate freemium subscription (free trial)."""
        if 'user_id' not in session:
            return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
        
        try:
            user_id = session['user_id']
            subscription = create_subscription(user_id, 'freemium', trial_days=7)
            subscription_info = get_user_subscription_info(user_id)
            
            return jsonify({
                'status': 'success',
                'message': 'Free trial activated successfully',
                'subscription': subscription_info
            })
        except Exception as e:
            logging.error(f"Error activating freemium: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': 'Failed to activate free trial'}), 500






