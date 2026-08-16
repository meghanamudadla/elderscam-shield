"""Static scam-pattern knowledge base.

Each entry is a dict with:
  - id: stable string identifier
  - category: "scam" | "safe"
  - text: a representative message (English; the TF-IDF retriever matches
          across languages well enough because digits, URLs and borrowed
          English words in Telugu messages still overlap with these texts)

This is a deliberately small, curated set of patterns that are extremely
common in India. It can grow over time; the retriever does not care.
"""

KNOWLEDGE_BASE: list[dict] = [
    # ------------------------------------------------------------- scams
    {
        "id": "kyc-block-urgency",
        "category": "scam",
        "text": (
            "Your bank account will be blocked in 24 hours. Your KYC has expired. "
            "Click this link immediately to update your KYC details and avoid "
            "penalty. Verify your identity now or your account will be frozen."
        ),
    },
    {
        "id": "otp-upi-phishing",
        "category": "scam",
        "text": (
            "Your UPI transaction is pending. Share your OTP, UPI PIN or card CVV "
            "with our customer care executive to complete the refund. Never share "
            "with anyone, but we need it now to reverse the debit."
        ),
    },
    {
        "id": "lottery-prize-fee",
        "category": "scam",
        "text": (
            "Congratulations! You have won a lottery prize of 25 lakh rupees. "
            "To receive your prize, pay a small processing fee and taxes first. "
            "Send money now to claim your winnings before the deadline."
        ),
    },
    {
        "id": "relative-distress",
        "category": "scam",
        "text": (
            "Hello father, this is your son. I am in big trouble, I had an accident "
            "and need money immediately for hospital. Do not tell anyone at home. "
            "Send 50,000 rupees to this account right now."
        ),
    },
    {
        "id": "fake-delivery-fee",
        "category": "scam",
        "text": (
            "Your courier package from Amazon is stuck at the depot because of an "
            "unpaid delivery fee of 2 rupees. Click this link and pay the fee to "
            "reschedule your delivery, otherwise the parcel will be returned."
        ),
    },
    {
        "id": "guaranteed-investment",
        "category": "scam",
        "text": (
            "Guaranteed returns of 20% every month! Invest in our stock market "
            "trading scheme and double your money in 90 days. Limited slots, "
            "deposit your money today through this app link to get started."
        ),
    },
    {
        "id": "govt-scheme-processing-fee",
        "category": "scam",
        "text": (
            "You are eligible for the PM Modi government scheme subsidy of "
            "50,000 rupees. Pay a one-time processing fee of 2,000 rupees to "
            "release your subsidy. Provide your Aadhaar and bank details now."
        ),
    },
    {
        "id": "fake-customer-care",
        "category": "scam",
        "text": (
            "Dear customer, your electricity bill payment failed. Call our toll "
            "free number 1800-XXX-XXXX or download our customer care app from this "
            "link to pay the pending amount and avoid disconnection."
        ),
    },
    {
        "id": "job-advance-fee",
        "category": "scam",
        "text": (
            "You are selected for a work from home job with a salary of 60,000 "
            "per month. Confirm your offer by paying a registration and training "
            "fee of 5,000 rupees to this bank account within 24 hours."
        ),
    },
    {
        "id": "digital-arrest",
        "category": "scam",
        "text": (
            "This is an officer from CBI. A parcel containing drugs was found in "
            "your name. You are under digital arrest. Stay on this video call, do "
            "not hang up, do not tell your family. Pay the fine immediately or a "
            "warrant will be issued and you will be arrested."
        ),
    },
    {
        "id": "vishing-bank-tax-official",
        "category": "scam",
        "text": (
            "Hello, I am calling from your bank and from the income tax "
            "department. Your PAN and account are under scrutiny for money "
            "laundering. To avoid your account being seized, verify your OTP and "
            "transfer your balance to the RBI settlement account now."
        ),
    },
    # ------------------------------------------------------------- safe
    {
        "id": "routine-bill",
        "category": "safe",
        "text": (
            "Your mobile bill of 299 rupees has been generated. Please pay the "
            "amount before the due date through the official app to avoid "
            "disconnection of service."
        ),
    },
    {
        "id": "user-triggered-otp",
        "category": "safe",
        "text": (
            "OTP 482913 is your one time password for the login you just requested "
            "on your own banking app. Do not share this code with anyone. The OTP "
            "is valid for 5 minutes only."
        ),
    },
    {
        "id": "known-contact-routine",
        "category": "safe",
        "text": (
            "Hi, this is Suresh from your office. Reminder that the team meeting "
            "is at 4 pm tomorrow in the conference room. Let me know if you can "
            "make it. Nothing urgent, just a routine update."
        ),
    },
]