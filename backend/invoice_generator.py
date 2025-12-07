"""
Invoice PDF generation for subscription payments.
"""
import os
import logging
import datetime
from io import BytesIO
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.pdfgen import canvas
from database import get_db_connection

# Company Details
COMPANY_NAME = "DRPINFOTECH PRIVATE LIMITED"
COMPANY_ADDRESS_LINE1 = "TS Homes Ratnakar Bagh Tankapani Road"
COMPANY_ADDRESS_LINE2 = "Bhubaneswar, Khorda, Orissa 751014, India"
COMPANY_EMAIL = "contact@drpinfotech.com"
COMPANY_PHONE = "+91 8249363019"
COMPANY_WEBSITE = "https://drpinfotech.com"
COMPANY_CIN = ""  # Add CIN if available (Corporate Identification Number)
COMPANY_GSTIN = ""  # Add GSTIN if available

# Enhanced Terms & Conditions
TERMS_CONDITIONS = [
    "This invoice is generated for subscription services provided by DRPINFOTECH PRIVATE LIMITED.",
    "Subscription will auto-renew monthly unless cancelled with 7 days prior notice.",
    "Cancellation requests must be submitted at least 7 days before the renewal date.",
    "No refunds will be provided for partial months or unused subscription periods.",
    "All services are provided as per the terms and conditions available on our website.",
    "For any disputes or queries, please contact us at contact@drpinfotech.com.",
    "This is a computer-generated invoice and does not require a physical signature."
]


def get_next_invoice_number() -> str:
    """
    Generate the next invoice number in serial format: INV/DRP/001, INV/DRP/002, etc.
    Uses atomic database operations to prevent duplicates.
    Returns the invoice number string.
    """
    conn = get_db_connection()
    try:
        # Use IMMEDIATE transaction to lock the database and prevent race conditions
        conn.execute('BEGIN IMMEDIATE')
        
        try:
            # Get the last invoice number from payments table (ordered by invoice number, not id)
            cursor = conn.execute(
                """
                SELECT invoice_number 
                FROM payments 
                WHERE invoice_number IS NOT NULL 
                ORDER BY CAST(SUBSTR(invoice_number, INSTR(invoice_number, '/') + 1) AS INTEGER) DESC 
                LIMIT 1
                """
            )
            last_invoice = cursor.fetchone()
            
            if last_invoice and last_invoice['invoice_number']:
                # Extract the number from last invoice (e.g., "INV/DRP/001" -> 1)
                try:
                    invoice_str = last_invoice['invoice_number']
                    # Find the last part after the last '/'
                    parts = invoice_str.split('/')
                    if len(parts) >= 3:
                        last_num = int(parts[-1])
                        next_num = last_num + 1
                    else:
                        # Fallback: try to extract number from end
                        last_num = int(invoice_str.split('/')[-1])
                        next_num = last_num + 1
                except (ValueError, IndexError, AttributeError):
                    next_num = 1
            else:
                next_num = 1
            
            invoice_number = f"INV/DRP/{next_num:03d}"
            
            # Verify this invoice number doesn't already exist (double-check for safety)
            existing = conn.execute(
                "SELECT id FROM payments WHERE invoice_number = ?",
                (invoice_number,)
            ).fetchone()
            
            if existing:
                # If it exists, increment and try again (shouldn't happen, but safety check)
                logging.warning(f"Invoice number {invoice_number} already exists, incrementing")
                next_num += 1
                invoice_number = f"INV/DRP/{next_num:03d}"
            
            conn.commit()
            return invoice_number
            
        except Exception as inner_e:
            conn.rollback()
            raise inner_e
            
    except Exception as e:
        logging.error(f"Error generating invoice number: {e}", exc_info=True)
        # Fallback: use timestamp-based invoice number to ensure uniqueness
        timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
        return f"INV/DRP/{timestamp[-6:]}"
    finally:
        conn.close()


def add_header_footer(canvas_obj, doc):
    """Add header and footer to each page."""
    # Save state
    canvas_obj.saveState()
    
    # Header - Company Name and Invoice Title
    canvas_obj.setFont('Helvetica-Bold', 16)
    canvas_obj.setFillColor(colors.HexColor('#0d6efd'))
    canvas_obj.drawString(0.5*inch, doc.height + 0.7*inch, COMPANY_NAME)
    
    canvas_obj.setFont('Helvetica', 12)
    canvas_obj.setFillColor(colors.black)
    canvas_obj.drawRightString(doc.width + 0.5*inch, doc.height + 0.7*inch, "TAX INVOICE")
    
    # Footer - Contact Information Only (address removed)
    canvas_obj.setFont('Helvetica', 9)
    canvas_obj.setFillColor(colors.HexColor('#666666'))
    canvas_obj.drawCentredString(doc.width / 2.0, 0.3*inch, f"Email: {COMPANY_EMAIL} | Phone: {COMPANY_PHONE} | Website: {COMPANY_WEBSITE}")
    canvas_obj.drawCentredString(doc.width / 2.0, 0.15*inch, "Bhubaneswar, Odisha, India")
    
    # Restore state
    canvas_obj.restoreState()


def generate_invoice_pdf(payment_data: dict, user_data: dict, subscription_data: dict = None) -> BytesIO:
    """
    Generate a professional PDF invoice for the payment.
    
    Args:
        payment_data: Dictionary containing payment information
        user_data: Dictionary containing user information (name, email)
        subscription_data: Optional dictionary containing subscription information
    
    Returns:
        BytesIO object containing the PDF data
    """
    buffer = BytesIO()
    
    # Create PDF document with custom header/footer (optimized for single page)
    doc = SimpleDocTemplate(
        buffer, 
        pagesize=A4, 
        topMargin=1.0*inch, 
        bottomMargin=0.6*inch,
        leftMargin=0.7*inch,
        rightMargin=0.7*inch
    )
    story = []
    
    # Get styles
    styles = getSampleStyleSheet()
    
    # Custom styles
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=12,
        textColor=colors.HexColor('#333333'),
        spaceAfter=8,
        spaceBefore=12,
        fontName='Helvetica-Bold'
    )
    
    normal_style = ParagraphStyle(
        'NormalStyle',
        parent=styles['Normal'],
        fontSize=10,
        leading=12,
        textColor=colors.black,
        fontName='Helvetica'
    )
    
    label_style = ParagraphStyle(
        'LabelStyle',
        parent=styles['Normal'],
        fontSize=10,
        leading=12,
        textColor=colors.black,
        fontName='Helvetica-Bold'
    )
    
    # Invoice Number and Date
    invoice_number = payment_data.get('invoice_number', get_next_invoice_number())
    transaction_date = payment_data.get('transaction_date', datetime.datetime.now(datetime.timezone.utc).isoformat())
    try:
        if isinstance(transaction_date, str):
            dt = datetime.datetime.fromisoformat(transaction_date.replace('Z', '+00:00'))
        else:
            dt = transaction_date
        invoice_date = dt.strftime('%d/%m/%Y')
    except:
        invoice_date = datetime.datetime.now().strftime('%d/%m/%Y')
    
    # Invoice Details Header
    invoice_header_data = [
        ['Invoice Number:', invoice_number, 'Invoice Date:', invoice_date]
    ]
    
    invoice_header_table = Table(invoice_header_data, colWidths=[1.5*inch, 2*inch, 1.5*inch, 2*inch])
    invoice_header_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (0, 0), 'LEFT'),
        ('ALIGN', (1, 0), (1, 0), 'LEFT'),
        ('ALIGN', (2, 0), (2, 0), 'LEFT'),
        ('ALIGN', (3, 0), (3, 0), 'LEFT'),
        ('FONTNAME', (0, 0), (0, 0), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, 0), 'Helvetica'),
        ('FONTNAME', (2, 0), (2, 0), 'Helvetica-Bold'),
        ('FONTNAME', (3, 0), (3, 0), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
    ]))
    
    story.append(invoice_header_table)
    story.append(Spacer(1, 0.2*inch))
    
    # Bill To Section
    story.append(Paragraph("Bill To:", heading_style))
    customer_name = user_data.get('name', 'Customer')
    customer_email = user_data.get('email', 'N/A')
    
    bill_to_data = [
        [customer_name],
        [customer_email]
    ]
    
    bill_to_table = Table(bill_to_data, colWidths=[7*inch])
    bill_to_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    
    story.append(bill_to_table)
    story.append(Spacer(1, 0.2*inch))
    
    # Service Description Table
    plan_name = payment_data.get('plan_name', 'Unknown Plan')
    plan_type = payment_data.get('plan_type', '')
    amount = float(payment_data.get('amount', 0))
    
    # Determine plan period
    if subscription_data:
        start_date = subscription_data.get('start_date')
        end_date = subscription_data.get('end_date')
        if start_date and end_date:
            try:
                if isinstance(start_date, str):
                    start_dt = datetime.datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                else:
                    start_dt = start_date
                if isinstance(end_date, str):
                    end_dt = datetime.datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                else:
                    end_dt = end_date
                
                days_diff = (end_dt - start_dt).days
                if days_diff >= 365:
                    period = "Annual"
                elif days_diff >= 30:
                    period = "Monthly"
                else:
                    period = f"{days_diff} Days"
            except:
                period = "Monthly"
        else:
            period = "Monthly"
    else:
        period = "Monthly"
    
    service_description = "Algorithmic Trading Platform Subscription"
    plan_description = f"{plan_name} Plan - {period}"
    
    service_data = [
        ['Description', 'Quantity', 'Unit Price (₹)', 'Amount (₹)'],
        [
            f"{service_description}\n{plan_description}",
            '1',
            f"₹{amount:,.2f}",
            f"₹{amount:,.2f}"
        ],
        ['', '', '', ''],
        ['', '', 'Subtotal:', f"₹{amount:,.2f}"],
        ['', '', 'Tax (GST):', '₹0.00'],
        ['', '', 'Total Amount:', f"₹{amount:,.2f}"]
    ]
    
    service_table = Table(service_data, colWidths=[3.5*inch, 1*inch, 1.5*inch, 1.5*inch])
    service_table.setStyle(TableStyle([
        # Header row
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0d6efd')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
        ('TOPPADDING', (0, 0), (-1, 0), 10),
        # Data rows
        ('BACKGROUND', (0, 1), (-1, 1), colors.white),
        ('ALIGN', (0, 1), (0, 1), 'LEFT'),
        ('ALIGN', (1, 1), (1, 1), 'CENTER'),
        ('ALIGN', (2, 1), (2, 1), 'RIGHT'),
        ('ALIGN', (3, 1), (3, 1), 'RIGHT'),
        ('FONTNAME', (0, 1), (-1, 1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, 1), 10),
        ('VALIGN', (0, 1), (0, 1), 'TOP'),
        # Grid
        ('GRID', (0, 0), (-1, 1), 1, colors.grey),
        # Total rows
        ('ALIGN', (2, 3), (3, -1), 'RIGHT'),
        ('FONTNAME', (2, 3), (3, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (2, 3), (3, -1), 10),
        ('LINEABOVE', (0, -1), (-1, -1), 2, colors.black),
        ('TOPPADDING', (0, 3), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 3), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    
    story.append(service_table)
    story.append(Spacer(1, 0.25*inch))
    
    # Payment Details
    story.append(Paragraph("Payment Details:", heading_style))
    payment_method = payment_data.get('payment_method', 'Unknown').title()
    razorpay_payment_id = payment_data.get('razorpay_payment_id', 'N/A')
    razorpay_order_id = payment_data.get('razorpay_order_id', 'N/A')
    
    payment_details_data = [
        ['Payment Method:', payment_method],
        ['Razorpay Payment ID:', razorpay_payment_id],
        ['Razorpay Order ID:', razorpay_order_id],
        ['Transaction Date:', invoice_date],
    ]
    
    payment_details_table = Table(payment_details_data, colWidths=[2*inch, 5*inch])
    payment_details_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (1, 0), (1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    
    story.append(payment_details_table)
    story.append(Spacer(1, 0.2*inch))
    
    # Terms & Conditions (condensed)
    story.append(Paragraph("Terms & Conditions:", heading_style))
    # Combine terms into fewer lines to save space
    terms_text = " • ".join(TERMS_CONDITIONS[:4])  # Show first 4 terms in one line
    story.append(Paragraph(f"• {terms_text}", normal_style))
    if len(TERMS_CONDITIONS) > 4:
        remaining_terms = " • ".join(TERMS_CONDITIONS[4:])
        story.append(Paragraph(f"• {remaining_terms}", normal_style))
    
    story.append(Spacer(1, 0.2*inch))
    
    # Authorized Signatory (compact)
    signature_data = [
        ['', 'Authorized Signatory'],
        ['', COMPANY_NAME]
    ]
    
    signature_table = Table(signature_data, colWidths=[4*inch, 3*inch])
    signature_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    
    story.append(signature_table)
    
    # Build PDF with header/footer
    doc.build(story, onFirstPage=add_header_footer, onLaterPages=add_header_footer)
    buffer.seek(0)
    return buffer


def save_invoice_number_to_payment(payment_id: int, invoice_number: str):
    """
    Save the invoice number to the payment record in the database.
    """
    conn = get_db_connection()
    try:
        conn.execute(
            "UPDATE payments SET invoice_number = ? WHERE id = ?",
            (invoice_number, payment_id)
        )
        conn.commit()
        logging.info(f"Invoice number {invoice_number} saved to payment ID {payment_id}")
    except Exception as e:
        logging.error(f"Error saving invoice number to payment: {e}", exc_info=True)
        conn.rollback()
    finally:
        conn.close()
