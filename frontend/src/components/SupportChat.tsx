import React, { useState } from 'react';
import { apiUrl } from '../config/api';

const initialFormState = {
  name: '',
  email: '',
  mobile: '',
  message: '',
};

type FeedbackState = { type: 'success' | 'danger'; text: string } | null;

const SupportChat: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState(initialFormState);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    setLoading(true);
    try {
      const response = await fetch(apiUrl('/api/contact'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to send message');
      }
      setFeedback({ type: 'success', text: data.message || 'Message sent successfully! Our team will get back to you soon.' });
      setForm(initialFormState);
      setTimeout(() => setIsOpen(false), 2000);
    } catch (error: any) {
      setFeedback({ type: 'danger', text: error.message || 'Unable to send message right now.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`support-widget ${isOpen ? 'open' : ''}`}>
      <button
        className="support-toggle btn btn-primary shadow"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {isOpen ? 'Close' : 'Chat with us'}
      </button>
      {isOpen && (
        <div className="support-panel shadow-lg">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <h6 className="mb-0">Connect with our team</h6>
              <small className="text-muted">Verify your email to send us a quick message.</small>
            </div>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setIsOpen(false)}>
              &times;
            </button>
          </div>
          {feedback && (
            <div className={`alert alert-${feedback.type}`} role="alert">
              {feedback.text}
            </div>
          )}
          <form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
            <input
              className="form-control"
              name="name"
              placeholder="Your name"
              value={form.name}
              onChange={handleChange}
              required
            />
            <input
              className="form-control"
              name="email"
              type="email"
              placeholder="you@company.com"
              value={form.email}
              onChange={handleChange}
              required
            />
            <input
              className="form-control"
              name="mobile"
              placeholder="Mobile number"
              value={form.mobile}
              onChange={handleChange}
              required
            />
            <textarea
              className="form-control"
              name="message"
              rows={3}
              placeholder="How can we help?"
              value={form.message}
              onChange={handleChange}
              required
            />
            <button className="btn btn-primary w-100" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                  Sending...
                </>
              ) : (
                'Send message'
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default SupportChat;

