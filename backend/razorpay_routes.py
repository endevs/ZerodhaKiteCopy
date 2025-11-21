"""
Razorpay payment and subscription API routes.
"""
import json
import logging
import datetime
import smtplib
import ssl
from flask import request, jsonify, session
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import razorpay
import config
from database import get_db_connection
from subscription_manager import (
    get_user_subscription,
    create_subscription,
    activate_subscription,
    check_feature_access,
    get_user_subscription_info,
    PLAN_TYPES,
    get_customization_price
)

# Initialize Razorpay client (use config module for consistency)
RAZORPAY_KEY_ID = config.RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET = config.RAZORPAY_KEY_SECRET
razorpay_client = None

if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET:
    try:
        razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
        logging.info("Razorpay client initialized successfully")
    except Exception as e:
        logging.error(f"Failed to initialize Razorpay client: {e}")


def send_payment_confirmation_email(user_email: str, user_name: str, payment_data: dict, subscription_data: dict):
    """Send payment confirmation email with receipt to user."""
    try:
        port = 465
        smtp_server = config.SMTP_SERVER
        sender_email = config.EMAIL_FROM
        receiver_email = user_email
        password = config.PASSWORD_EMAIL
        
        if not all([smtp_server, sender_email, password]):
            missing = []
            if not smtp_server:
                missing.append("SMTP_SERVER")
            if not sender_email:
                missing.append("EMAIL_FROM")
            if not password:
                missing.append("PASSWORD_EMAIL")
            logging.warning(f"Email configuration incomplete. Missing: {', '.join(missing)}. Skipping payment confirmation email to {user_email}")
            return False
        
        # Get plan name from payment_data first (for customization plans), then from subscription_data
        plan_name = payment_data.get('plan_name') or subscription_data.get('plan_name', 'Unknown Plan')
        amount = payment_data.get('amount', 0)
        payment_id = payment_data.get('razorpay_payment_id', 'N/A')
        order_id = payment_data.get('razorpay_order_id', 'N/A')
        transaction_date = payment_data.get('transaction_date', datetime.datetime.now(datetime.timezone.utc).isoformat())
        payment_method = payment_data.get('payment_method', 'Unknown')
        
        # Format date
        try:
            if isinstance(transaction_date, str):
                dt = datetime.datetime.fromisoformat(transaction_date.replace('Z', '+00:00'))
            else:
                dt = transaction_date
            formatted_date = dt.strftime('%d %B %Y, %I:%M %p')
        except:
            formatted_date = str(transaction_date)
        
        # Determine if this is a customization plan (one-time service) or subscription
        is_customization = plan_name == 'Strategy Customization'
        
        message = MIMEMultipart("alternative")
        if is_customization:
            message["Subject"] = f"Payment Confirmation - {plan_name}"
        else:
            message["Subject"] = f"Payment Confirmation - {plan_name} Subscription"
        message["From"] = f"DRP Infotech Pvt Ltd <{sender_email}>"
        message["To"] = receiver_email
        
        if is_customization:
            text = f"""
        DRP Infotech Pvt Ltd - Payment Confirmation
        
        Dear {user_name},
        
        Thank you for choosing {plan_name}!
        
        Payment Details:
        - Amount: ₹{amount:.2f}
        - Payment ID: {payment_id}
        - Order ID: {order_id}
        - Payment Method: {payment_method}
        - Transaction Date: {formatted_date}
        
        Your customization request has been received. Our expert team will contact you shortly to discuss your requirements.
        
        Best regards,
        DRP Infotech Pvt Ltd
        """
        else:
            text = f"""
        DRP Infotech Pvt Ltd - Payment Confirmation
        
        Dear {user_name},
        
        Thank you for subscribing to {plan_name}!
        
        Payment Details:
        - Amount: ₹{amount:.2f}
        - Payment ID: {payment_id}
        - Order ID: {order_id}
        - Payment Method: {payment_method}
        - Transaction Date: {formatted_date}
        
        Your subscription has been activated successfully.
        
        Best regards,
        DRP Infotech Pvt Ltd
        """
        
        html = f"""
        <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background-color: #28a745; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
                        <h2 style="margin: 0;">✓ Payment Successful</h2>
                        <p style="margin: 5px 0 0 0; font-size: 14px;">DRP Infotech Trading Platform</p>
                    </div>
                    <div style="background-color: #f8f9fa; padding: 30px; border-radius: 0 0 5px 5px;">
                        <p>Dear <strong>{user_name}</strong>,</p>
                        {f'<p>Thank you for choosing <strong>{plan_name}</strong>! Your payment has been processed successfully.</p><p>Our expert team will contact you shortly to discuss your requirements and build a custom strategy tailored to your needs.</p>' if is_customization else f'<p>Thank you for subscribing to <strong>{plan_name}</strong>! Your payment has been processed successfully.</p>'}
                        
                        <div style="background-color: white; padding: 20px; border-radius: 5px; margin: 20px 0; border: 1px solid #dee2e6;">
                            <h3 style="color: #0d6efd; margin-top: 0;">Payment Receipt</h3>
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;"><strong>Amount Paid:</strong></td>
                                    <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right;">₹{amount:.2f}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;"><strong>Plan:</strong></td>
                                    <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right;">{plan_name}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;"><strong>Payment ID:</strong></td>
                                    <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right; font-family: monospace; font-size: 12px;">{payment_id}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;"><strong>Order ID:</strong></td>
                                    <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right; font-family: monospace; font-size: 12px;">{order_id}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;"><strong>Payment Method:</strong></td>
                                    <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6; text-align: right;">{payment_method.title()}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0;"><strong>Transaction Date:</strong></td>
                                    <td style="padding: 8px 0; text-align: right;">{formatted_date}</td>
                                </tr>
                            </table>
                        </div>
                        
                        {f'<p style="color: #28a745; font-weight: bold;">Your customization request has been received! Our team will contact you shortly.</p>' if is_customization else '<p style="color: #28a745; font-weight: bold;">Your subscription has been activated successfully!</p>'}
                        
                        <hr style="border: none; border-top: 1px solid #dee2e6; margin: 30px 0;">
                        <div style="text-align: center; color: #666; font-size: 12px;">
                            <p style="margin: 5px 0;"><strong>DRP Infotech Pvt Ltd</strong></p>
                            <p style="margin: 5px 0;">Email: <a href="mailto:contact@drpinfotech.com" style="color: #0d6efd; text-decoration: none;">contact@drpinfotech.com</a></p>
                            <p style="margin: 5px 0;">Website: <a href="https://drpinfotech.com" style="color: #0d6efd; text-decoration: none;">drpinfotech.com</a></p>
                        </div>
                    </div>
                </div>
            </body>
        </html>
        """
        
        message.attach(MIMEText(text, "plain"))
        message.attach(MIMEText(html, "html"))
        
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(smtp_server, port, context=context) as server:
            logging.info(f"Connecting to SMTP server {smtp_server}:{port}...")
            server.login(sender_email, password)
            logging.info(f"SMTP login successful. Sending email to {receiver_email}...")
            server.sendmail(sender_email, receiver_email, message.as_string())
            logging.info(f"Email sent successfully to {receiver_email}")
        
        logging.info(f"Payment confirmation email sent successfully to {user_email}")
        return True
    except smtplib.SMTPAuthenticationError as e:
        logging.error(f"SMTP authentication failed. Check EMAIL_FROM and PASSWORD_EMAIL: {e}")
        return False
    except smtplib.SMTPException as e:
        logging.error(f"SMTP error sending payment confirmation email: {e}")
        return False
    except Exception as e:
        logging.error(f"Error sending payment confirmation email to {user_email}: {e}", exc_info=True)
        return False


def register_razorpay_routes(app):
    """Register all Razorpay-related routes with the Flask app."""
    
    @app.route("/api/subscription/info", methods=['GET'])
    def api_subscription_info():
        """Get current user's subscription information."""
        if 'user_id' not in session:
            return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
        
        try:
            user_id = session['user_id']
            subscription_info = get_user_subscription_info(user_id)
            return jsonify({
                'status': 'success',
                'subscription': subscription_info
            })
        except Exception as e:
            logging.error(f"Error fetching subscription info: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': 'Failed to fetch subscription info'}), 500

    @app.route("/api/payment/create-order", methods=['POST'])
    def api_create_payment_order():
        """Create a Razorpay order for subscription payment."""
        if 'user_id' not in session:
            return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
        
        if not razorpay_client:
            return jsonify({'status': 'error', 'message': 'Payment gateway not configured'}), 500
        
        try:
            data = request.get_json()
            plan_type = data.get('plan_type')
            amount = data.get('amount')
            
            user_id = session['user_id']
            
            # Handle customization plan separately
            if plan_type == 'customization':
                plan_info = {'name': 'Strategy Customization', 'price': get_customization_price()}
                if amount is None:
                    amount = get_customization_price()
            elif not plan_type or plan_type not in PLAN_TYPES:
                return jsonify({'status': 'error', 'message': 'Invalid plan type'}), 400
            else:
                plan_info = PLAN_TYPES[plan_type]
                # Use provided amount or plan price
                if amount is None:
                    from subscription_manager import get_plan_price
                    amount = get_plan_price(plan_type)  # Get fresh price from DB
            
            # Convert to paise (Razorpay uses smallest currency unit)
            amount_paise = int(amount * 100)
            
            # Create Razorpay order
            order_data = {
                'amount': amount_paise,
                'currency': 'INR',
                'receipt': f'sub_{user_id}_{plan_type}_{int(datetime.datetime.now(datetime.timezone.utc).timestamp())}',
                'notes': {
                    'user_id': user_id,
                    'plan_type': plan_type,
                    'plan_name': plan_info['name']
                }
            }
            
            try:
                razorpay_order = razorpay_client.order.create(data=order_data)
            except Exception as e:
                logging.error(f"Razorpay API error creating order: {e}", exc_info=True)
                # Check if it's a connection error
                error_str = str(e).lower()
                if 'connection' in error_str or 'reset' in error_str or 'aborted' in error_str:
                    return jsonify({'status': 'error', 'message': 'Payment gateway connection error. Please try again in a moment.'}), 503
                return jsonify({'status': 'error', 'message': f'Failed to create payment order: {str(e)}'}), 500
            
            # Store payment record in database
            conn = get_db_connection()
            try:
                cursor = conn.execute(
                    """
                    INSERT INTO payments (
                        user_id, razorpay_order_id, amount, currency, plan_type, payment_status
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        razorpay_order['id'],
                        amount,
                        'INR',
                        plan_type,
                        'pending'
                    )
                )
                payment_id = cursor.lastrowid
                conn.commit()
            except Exception as e:
                conn.rollback()
                logging.error(f"Error storing payment record: {e}", exc_info=True)
                raise
            finally:
                conn.close()
            
            return jsonify({
                'status': 'success',
                'order': {
                    'id': razorpay_order['id'],
                    'amount': razorpay_order['amount'],
                    'currency': razorpay_order['currency'],
                    'key_id': RAZORPAY_KEY_ID,
                    'payment_id': payment_id
                }
            })
        except Exception as e:
            logging.error(f"Error creating payment order: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': 'Failed to create payment order'}), 500

    @app.route("/api/payment/verify", methods=['POST'])
    def api_verify_payment():
        """Verify Razorpay payment and activate subscription."""
        if 'user_id' not in session:
            return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
        
        if not razorpay_client:
            return jsonify({'status': 'error', 'message': 'Payment gateway not configured'}), 500
        
        try:
            data = request.get_json()
            razorpay_order_id = data.get('razorpay_order_id')
            razorpay_payment_id = data.get('razorpay_payment_id')
            razorpay_signature = data.get('razorpay_signature')
            
            if not all([razorpay_order_id, razorpay_payment_id, razorpay_signature]):
                return jsonify({'status': 'error', 'message': 'Missing payment details'}), 400
            
            user_id = session['user_id']
            
            # Verify payment signature
            params = {
                'razorpay_order_id': razorpay_order_id,
                'razorpay_payment_id': razorpay_payment_id,
                'razorpay_signature': razorpay_signature
            }
            
            try:
                razorpay_client.utility.verify_payment_signature(params)
            except Exception as e:
                logging.error(f"Payment signature verification failed: {e}")
                return jsonify({'status': 'error', 'message': 'Invalid payment signature'}), 400
            
            # Get payment details from Razorpay
            try:
                payment_details = razorpay_client.payment.fetch(razorpay_payment_id)
            except Exception as e:
                logging.error(f"Error fetching payment details from Razorpay: {e}", exc_info=True)
                return jsonify({'status': 'error', 'message': f'Failed to fetch payment details: {str(e)}'}), 500
            
            # Update payment record in database
            conn = get_db_connection()
            try:
                # Get payment record
                payment_row = conn.execute(
                    "SELECT * FROM payments WHERE razorpay_order_id = ? AND user_id = ?",
                    (razorpay_order_id, user_id)
                ).fetchone()
                
                if not payment_row:
                    logging.error(f"Payment record not found for order_id={razorpay_order_id}, user_id={user_id}")
                    return jsonify({'status': 'error', 'message': 'Payment record not found'}), 404
                
                payment = dict(payment_row)
                plan_type = payment.get('plan_type')
                
                # Handle customization plan separately (it's not a subscription)
                is_customization = (plan_type == 'customization')
                
                if not plan_type:
                    logging.error(f"Missing plan_type in payment record")
                    return jsonify({'status': 'error', 'message': 'Missing plan type in payment record'}), 400
                
                if not is_customization and plan_type not in PLAN_TYPES:
                    logging.error(f"Invalid plan_type in payment record: {plan_type}")
                    return jsonify({'status': 'error', 'message': f'Invalid plan type: {plan_type}'}), 400
                
                # Update payment status
                payment_method = 'unknown'
                if isinstance(payment_details, dict):
                    payment_method = payment_details.get('method', 'unknown')
                
                conn.execute(
                    """
                    UPDATE payments 
                    SET razorpay_payment_id = ?, razorpay_signature = ?,
                        payment_status = ?, payment_method = ?, transaction_date = CURRENT_TIMESTAMP,
                        metadata = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (
                        razorpay_payment_id,
                        razorpay_signature,
                        'completed',
                        payment_method,
                        json.dumps(payment_details) if payment_details else '{}',
                        payment['id']
                    )
                )
                
                # Add to payment history
                conn.execute(
                    """
                    INSERT INTO payment_history (payment_id, status, status_message, razorpay_response)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        payment['id'],
                        'completed',
                        'Payment verified successfully',
                        json.dumps(payment_details) if payment_details else '{}'
                    )
                )
                
                # Commit payment updates first
                conn.commit()
                
                # Get user details for email before closing connection
                user_row = conn.execute(
                    "SELECT email, user_name FROM users WHERE id = ?",
                    (user_id,)
                ).fetchone()
                
                # Close payment connection before creating subscription to avoid locks
                conn.close()
                conn = None
                
                subscription_id = None
                
                # Only create subscription for subscription plans, not for customization
                if not is_customization:
                    # Create or activate subscription (separate connection to avoid locks)
                    try:
                        subscription = get_user_subscription(user_id)
                        if subscription and subscription.get('plan_type') == plan_type:
                            # Update existing subscription
                            activate_subscription(subscription['id'])
                            subscription_id = subscription['id']
                        else:
                            # Create new subscription
                            new_subscription = create_subscription(user_id, plan_type)
                            subscription_id = new_subscription['id']
                    except Exception as e:
                        logging.error(f"Error creating/activating subscription: {e}", exc_info=True)
                        # Payment is already committed, so we can't rollback
                        # Try to create subscription asynchronously or provide manual recovery
                        error_msg = str(e)
                        if 'database is busy' in error_msg.lower() or 'locked' in error_msg.lower():
                            # For database locks, we can try to create it in the background
                            # For now, return success but warn the user
                            logging.warning(f"Subscription creation failed due to database lock. Payment ID: {payment['id']}, User ID: {user_id}, Plan: {plan_type}")
                            return jsonify({
                                'status': 'partial_success',
                                'message': 'Payment processed successfully, but subscription activation is pending due to system load. Your subscription will be activated shortly. If you do not see it within 5 minutes, please contact support.',
                                'payment_id': payment['id'],
                                'warning': True
                            }), 200
                        else:
                            return jsonify({'status': 'error', 'message': f'Payment processed but failed to create subscription: {str(e)}. Please contact support with payment ID: {payment["id"]}'}), 500
                    
                    # Link payment to subscription (new connection)
                    if subscription_id:
                        conn = get_db_connection()
                        try:
                            conn.execute(
                                "UPDATE payments SET subscription_id = ? WHERE id = ?",
                                (subscription_id, payment['id'])
                            )
                            conn.commit()
                        except Exception as e:
                            logging.error(f"Error linking payment to subscription: {e}", exc_info=True)
                        finally:
                            if conn:
                                conn.close()
                
                # Get updated subscription info (only for subscription plans)
                subscription_info = None
                if not is_customization:
                    try:
                        subscription_info = get_user_subscription_info(user_id)
                    except Exception as e:
                        logging.error(f"Error fetching subscription info: {e}", exc_info=True)
                        subscription_info = None
                
                # Prepare receipt data
                if is_customization:
                    plan_name = 'Strategy Customization'
                else:
                    plan_name = PLAN_TYPES[plan_type]['name']
                
                receipt_data = {
                    'payment_id': payment['id'],
                    'razorpay_payment_id': razorpay_payment_id,
                    'razorpay_order_id': razorpay_order_id,
                    'amount': payment['amount'],
                    'currency': payment['currency'],
                    'payment_method': payment_method,
                    'transaction_date': payment.get('transaction_date') or datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'plan_type': plan_type,
                    'plan_name': plan_name
                }
                
                # Send confirmation email
                if user_row:
                    # Convert sqlite3.Row to dict
                    user_dict = dict(user_row)
                    user_email = user_dict['email']
                    
                    # Get user name: first from database, then from Zerodha API, then fallback to email
                    user_name = user_dict.get('user_name')
                    
                    if not user_name:
                        # Try to fetch from Zerodha API
                        try:
                            from app import _get_user_name_from_zerodha
                            user_name = _get_user_name_from_zerodha(user_id)
                        except Exception as e:
                            logging.warning(f"Could not fetch user name from Zerodha: {e}")
                    
                    # Final fallback: extract name from email or use "User"
                    if not user_name:
                        user_name = user_email.split('@')[0] if user_email else 'User'
                    
                    try:
                        email_sent = send_payment_confirmation_email(
                            user_email,
                            user_name,
                            receipt_data,
                            subscription_info or {}
                        )
                        if not email_sent:
                            logging.warning(f"Payment confirmation email was not sent to {user_email}. Check email configuration.")
                        else:
                            logging.info(f"Payment confirmation email sent successfully to {user_email}")
                    except Exception as e:
                        logging.error(f"Failed to send payment confirmation email: {e}", exc_info=True)
                        # Don't fail the payment if email fails
                
                success_message = 'Payment verified and subscription activated' if not is_customization else 'Payment verified. Your customization request has been received.'
                
                return jsonify({
                    'status': 'success',
                    'message': success_message,
                    'subscription': subscription_info,
                    'receipt': receipt_data
                })
            except Exception as e:
                if conn:
                    try:
                        conn.rollback()
                    except:
                        pass
                logging.error(f"Error updating payment record: {e}", exc_info=True)
                return jsonify({'status': 'error', 'message': f'Database error: {str(e)}'}), 500
            finally:
                if conn:
                    conn.close()
                
        except Exception as e:
            logging.error(f"Error verifying payment: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': f'Failed to verify payment: {str(e)}'}), 500

    @app.route("/api/subscription/check-feature", methods=['GET'])
    def api_check_feature():
        """Check if user has access to a specific feature."""
        if 'user_id' not in session:
            return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
        
        try:
            user_id = session['user_id']
            feature = request.args.get('feature')
            
            if not feature:
                return jsonify({'status': 'error', 'message': 'Feature name required'}), 400
            
            has_access = check_feature_access(user_id, feature)
            
            return jsonify({
                'status': 'success',
                'feature': feature,
                'has_access': has_access
            })
        except Exception as e:
            logging.error(f"Error checking feature access: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': 'Failed to check feature access'}), 500

