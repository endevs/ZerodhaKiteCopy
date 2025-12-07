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
from email.mime.base import MIMEBase
from email import encoders
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
from invoice_generator import generate_invoice_pdf, get_next_invoice_number, save_invoice_number_to_payment

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


def send_payment_confirmation_email(user_email: str, user_name: str, payment_data: dict, subscription_data: dict, payment_id: int = None):
    """Send payment confirmation email with PDF invoice attachment to user."""
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
        
        # Generate and attach PDF invoice
        try:
            # Use invoice number from payment_data (should already be set during payment verification)
            invoice_number = payment_data.get('invoice_number')
            if not invoice_number and payment_id:
                # Fallback: if invoice number not set, get it from database
                conn = get_db_connection()
                try:
                    payment_row = conn.execute(
                        "SELECT invoice_number FROM payments WHERE id = ?",
                        (payment_id,)
                    ).fetchone()
                    if payment_row and payment_row['invoice_number']:
                        invoice_number = payment_row['invoice_number']
                    else:
                        # Last resort: generate new invoice number (shouldn't happen)
                        logging.warning(f"Invoice number missing for payment {payment_id}, generating new one")
                        invoice_number = get_next_invoice_number()
                        save_invoice_number_to_payment(payment_id, invoice_number)
                finally:
                    conn.close()
            
            if invoice_number:
                payment_data['invoice_number'] = invoice_number
            
            # Prepare user data for invoice
            user_invoice_data = {
                'name': user_name,
                'email': user_email
            }
            
            # Generate PDF invoice
            pdf_buffer = generate_invoice_pdf(payment_data, user_invoice_data, subscription_data)
            
            # Attach PDF to email
            pdf_attachment = MIMEBase('application', 'pdf')
            pdf_attachment.set_payload(pdf_buffer.read())
            encoders.encode_base64(pdf_attachment)
            pdf_filename = f"Invoice_{invoice_number.replace('/', '_')}.pdf"
            pdf_attachment.add_header(
                'Content-Disposition',
                f'attachment; filename= {pdf_filename}'
            )
            message.attach(pdf_attachment)
            
            logging.info(f"PDF invoice {invoice_number} generated and attached to email")
        except Exception as e:
            logging.error(f"Error generating PDF invoice: {e}", exc_info=True)
            # Continue sending email even if PDF generation fails
            logging.warning("Email will be sent without PDF attachment")
        
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(smtp_server, port, context=context) as server:
            logging.info(f"Connecting to SMTP server {smtp_server}:{port}...")
            server.login(sender_email, password)
            logging.info(f"SMTP login successful. Sending email to {receiver_email}...")
            server.sendmail(sender_email, receiver_email, message.as_string())
            logging.info(f"Email sent successfully to {receiver_email}")
        
        logging.info(f"Payment confirmation email with invoice sent successfully to {user_email}")
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
    logging.info("Registering Razorpay routes...")
    
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
        logging.info(f"Payment create-order endpoint called: method={request.method}, path={request.path}")
        
        # Ensure we return JSON with proper Content-Type
        if 'user_id' not in session:
            response = jsonify({'status': 'error', 'message': 'User not logged in'})
            response.headers['Content-Type'] = 'application/json'
            return response, 401
        
        if not razorpay_client:
            response = jsonify({'status': 'error', 'message': 'Payment gateway not configured'})
            response.headers['Content-Type'] = 'application/json'
            return response, 500
        
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
                response = jsonify({'status': 'error', 'message': 'Invalid plan type'})
                response.headers['Content-Type'] = 'application/json'
                return response, 400
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
                    response = jsonify({'status': 'error', 'message': 'Payment gateway connection error. Please try again in a moment.'})
                    response.headers['Content-Type'] = 'application/json'
                    return response, 503
                response = jsonify({'status': 'error', 'message': f'Failed to create payment order: {str(e)}'})
                response.headers['Content-Type'] = 'application/json'
                return response, 500
            
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
            
            response = jsonify({
                'status': 'success',
                'order': {
                    'id': razorpay_order['id'],
                    'amount': razorpay_order['amount'],
                    'currency': razorpay_order['currency'],
                    'key_id': RAZORPAY_KEY_ID,
                    'payment_id': payment_id
                }
            })
            response.headers['Content-Type'] = 'application/json'
            return response
        except Exception as e:
            logging.error(f"Error creating payment order: {e}", exc_info=True)
            response = jsonify({'status': 'error', 'message': 'Failed to create payment order'})
            response.headers['Content-Type'] = 'application/json'
            return response, 500

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
                
                # Generate and save invoice number immediately after payment verification (atomic)
                invoice_number = None
                if not payment.get('invoice_number'):
                    try:
                        invoice_number = get_next_invoice_number()
                        # Save invoice number to database immediately
                        save_invoice_number_to_payment(payment['id'], invoice_number)
                        logging.info(f"Invoice number {invoice_number} assigned to payment ID {payment['id']}")
                    except Exception as e:
                        logging.error(f"Error assigning invoice number: {e}", exc_info=True)
                        # Continue without invoice number - will be generated later if needed
                else:
                    invoice_number = payment.get('invoice_number')
                
                # Prepare receipt data
                if is_customization:
                    plan_name = 'Strategy Customization'
                else:
                    plan_name = PLAN_TYPES[plan_type]['name']
                
                receipt_data = {
                    'payment_id': payment['id'],
                    'invoice_number': invoice_number,  # Include invoice number in receipt data
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

    @app.route("/api/invoice/download/<int:payment_id>", methods=['GET'])
    def api_download_invoice(payment_id):
        """Download invoice PDF for a payment (user or admin)."""
        if 'user_id' not in session:
            return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
        
        user_id = session['user_id']
        # Check if user is admin using the same method as other admin endpoints
        from app import _require_admin
        is_admin = _require_admin()
        
        try:
            conn = get_db_connection()
            try:
                # Get payment record
                payment_row = conn.execute(
                    """
                    SELECT p.*, u.email, u.user_name 
                    FROM payments p
                    JOIN users u ON p.user_id = u.id
                    WHERE p.id = ?
                    """,
                    (payment_id,)
                ).fetchone()
                
                if not payment_row:
                    return jsonify({'status': 'error', 'message': 'Payment not found'}), 404
                
                payment = dict(payment_row)
                
                # Check if user has access (either owns the payment or is admin)
                if not is_admin and payment['user_id'] != user_id:
                    return jsonify({'status': 'error', 'message': 'Unauthorized access'}), 403
                
                # Check if payment is completed
                if payment.get('payment_status') != 'completed':
                    return jsonify({'status': 'error', 'message': 'Invoice only available for completed payments'}), 400
                
                # Get subscription info if available
                subscription_info = None
                if payment.get('subscription_id'):
                    sub_row = conn.execute(
                        "SELECT * FROM subscriptions WHERE id = ?",
                        (payment['subscription_id'],)
                    ).fetchone()
                    if sub_row:
                        subscription_info = dict(sub_row)
                
            finally:
                conn.close()
            
            # Get invoice number from database (must exist for completed payments)
            invoice_number = payment.get('invoice_number')
            if not invoice_number:
                # If missing, generate and save it (shouldn't happen, but handle gracefully)
                logging.warning(f"Invoice number missing for payment {payment['id']}, generating now")
                invoice_number = get_next_invoice_number()
                save_invoice_number_to_payment(payment['id'], invoice_number)
            
            # Prepare payment data (same structure as email generation)
            payment_data = {
                'payment_id': payment['id'],
                'invoice_number': invoice_number,
                'razorpay_payment_id': payment.get('razorpay_payment_id', 'N/A'),
                'razorpay_order_id': payment.get('razorpay_order_id', 'N/A'),
                'amount': payment['amount'],
                'currency': payment.get('currency', 'INR'),
                'payment_method': payment.get('payment_method', 'Unknown'),
                'transaction_date': payment.get('transaction_date') or datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'plan_type': payment.get('plan_type', ''),
                'plan_name': payment.get('plan_type', 'Unknown Plan').replace('_', ' ').title()
            }
            
            # Get plan name from PLAN_TYPES if available
            if payment_data['plan_type'] in PLAN_TYPES:
                payment_data['plan_name'] = PLAN_TYPES[payment_data['plan_type']]['name']
            elif payment_data['plan_type'] == 'customization':
                payment_data['plan_name'] = 'Strategy Customization'
            
            # Prepare user data (same structure as email generation)
            user_data = {
                'name': payment.get('user_name') or 'Customer',
                'email': payment.get('email', 'N/A')
            }
            
            # Generate PDF using the same function as email (ensures consistency)
            pdf_buffer = generate_invoice_pdf(payment_data, user_data, subscription_info)
            
            # Return PDF as response
            from flask import Response
            invoice_number = payment_data['invoice_number'].replace('/', '_')
            filename = f"Invoice_{invoice_number}.pdf"
            
            return Response(
                pdf_buffer.getvalue(),
                mimetype='application/pdf',
                headers={
                    'Content-Disposition': f'attachment; filename={filename}'
                }
            )
            
        except Exception as e:
            logging.error(f"Error generating invoice PDF: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': f'Failed to generate invoice: {str(e)}'}), 500

    @app.route("/api/invoice/resend/<int:payment_id>", methods=['POST'])
    def api_resend_invoice(payment_id):
        """Resend invoice email to user."""
        if 'user_id' not in session:
            return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
        
        user_id = session['user_id']
        # Check if user is admin using the same method as other admin endpoints
        from app import _require_admin
        is_admin = _require_admin()
        
        try:
            conn = get_db_connection()
            try:
                # Get payment record
                payment_row = conn.execute(
                    """
                    SELECT p.*, u.email, u.user_name 
                    FROM payments p
                    JOIN users u ON p.user_id = u.id
                    WHERE p.id = ?
                    """,
                    (payment_id,)
                ).fetchone()
                
                if not payment_row:
                    return jsonify({'status': 'error', 'message': 'Payment not found'}), 404
                
                payment = dict(payment_row)
                
                # Check if user has access (either owns the payment or is admin)
                if not is_admin and payment['user_id'] != user_id:
                    return jsonify({'status': 'error', 'message': 'Unauthorized access'}), 403
                
                # Check if payment is completed
                if payment.get('payment_status') != 'completed':
                    return jsonify({'status': 'error', 'message': 'Invoice can only be resent for completed payments'}), 400
                
                # Get subscription info if available
                subscription_info = None
                if payment.get('subscription_id'):
                    sub_row = conn.execute(
                        "SELECT * FROM subscriptions WHERE id = ?",
                        (payment['subscription_id'],)
                    ).fetchone()
                    if sub_row:
                        subscription_info = dict(sub_row)
                        # Get subscription info using subscription_manager
                        try:
                            subscription_info = get_user_subscription_info(payment['user_id'])
                        except:
                            pass
                
            finally:
                conn.close()
            
            # Get invoice number from database (must exist for completed payments)
            invoice_number = payment.get('invoice_number')
            if not invoice_number:
                # If missing, generate and save it (shouldn't happen, but handle gracefully)
                logging.warning(f"Invoice number missing for payment {payment['id']}, generating now")
                invoice_number = get_next_invoice_number()
                save_invoice_number_to_payment(payment['id'], invoice_number)
            
            # Prepare payment data (same structure as email generation)
            payment_data = {
                'payment_id': payment['id'],
                'invoice_number': invoice_number,
                'razorpay_payment_id': payment.get('razorpay_payment_id', 'N/A'),
                'razorpay_order_id': payment.get('razorpay_order_id', 'N/A'),
                'amount': payment['amount'],
                'currency': payment.get('currency', 'INR'),
                'payment_method': payment.get('payment_method', 'Unknown'),
                'transaction_date': payment.get('transaction_date') or datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'plan_type': payment.get('plan_type', ''),
                'plan_name': payment.get('plan_type', 'Unknown Plan').replace('_', ' ').title()
            }
            
            # Get plan name from PLAN_TYPES if available
            if payment_data['plan_type'] in PLAN_TYPES:
                payment_data['plan_name'] = PLAN_TYPES[payment_data['plan_type']]['name']
            elif payment_data['plan_type'] == 'customization':
                payment_data['plan_name'] = 'Strategy Customization'
            
            # Prepare user data (same structure as email generation)
            user_name = payment.get('user_name') or payment.get('email', 'Customer').split('@')[0]
            user_email = payment.get('email')
            
            # Send email
            email_sent = send_payment_confirmation_email(
                user_email,
                user_name,
                payment_data,
                subscription_info or {},
                payment['id']
            )
            
            if email_sent:
                return jsonify({
                    'status': 'success',
                    'message': 'Invoice email sent successfully'
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'Failed to send invoice email. Please check email configuration.'
                }), 500
                
        except Exception as e:
            logging.error(f"Error resending invoice email: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': f'Failed to resend invoice: {str(e)}'}), 500

    @app.route("/api/invoice/list", methods=['GET'])
    def api_list_invoices():
        """Get list of invoices for current user."""
        if 'user_id' not in session:
            return jsonify({'status': 'error', 'message': 'User not logged in'}), 401
        
        user_id = session['user_id']
        is_admin = session.get('is_admin', False)
        
        try:
            conn = get_db_connection()
            try:
                if is_admin:
                    # Admin can see all invoices
                    payments = conn.execute(
                        """
                        SELECT p.*, u.email, u.user_name 
                        FROM payments p
                        JOIN users u ON p.user_id = u.id
                        WHERE p.payment_status = 'completed'
                        ORDER BY p.transaction_date DESC
                        """
                    ).fetchall()
                else:
                    # User can only see their own invoices
                    payments = conn.execute(
                        """
                        SELECT p.*, u.email, u.user_name 
                        FROM payments p
                        JOIN users u ON p.user_id = u.id
                        WHERE p.user_id = ? AND p.payment_status = 'completed'
                        ORDER BY p.transaction_date DESC
                        """,
                        (user_id,)
                    ).fetchall()
                
                invoices = []
                for payment in payments:
                    p = dict(payment)
                    invoices.append({
                        'payment_id': p['id'],
                        'invoice_number': p.get('invoice_number', 'N/A'),
                        'amount': float(p['amount']),
                        'plan_type': p.get('plan_type', ''),
                        'transaction_date': p.get('transaction_date', ''),
                        'user_name': p.get('user_name', ''),
                        'user_email': p.get('email', '')
                    })
                
            finally:
                conn.close()
            
            return jsonify({
                'status': 'success',
                'invoices': invoices
            })
            
        except Exception as e:
            logging.error(f"Error listing invoices: {e}", exc_info=True)
            return jsonify({'status': 'error', 'message': f'Failed to list invoices: {str(e)}'}), 500

