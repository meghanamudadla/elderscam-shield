import sys
import json
import urllib.request
import urllib.parse
from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding='utf-8')

EXACT_SMS = "Dear,greatdealsforyouin@ Your account has been successfully credited Rs.10001. @ 21April Proceed to withdraw before 9PM. bit.ly/4mLF4fa OrderNowonudaanTNCA"

def create_test_images():
    # 1. Cropped image: only the SMS message
    img_cropped = Image.new("RGB", (700, 160), color=(255, 255, 255))
    draw_c = ImageDraw.Draw(img_cropped)
    
    words = EXACT_SMS.split(" ")
    lines = []
    curr = ""
    for w in words:
        if len(curr + " " + w) > 50:
            lines.append(curr)
            curr = w
        else:
            curr = (curr + " " + w).strip()
    if curr:
        lines.append(curr)

    y = 20
    for line in lines:
        draw_c.text((20, y), line, fill=(0, 0, 0))
        y += 28

    img_cropped.save("cropped_sms.png")

    # 2. Full screen image: status bar, Truecaller banner, 100% secure notice, SMS, transaction card, status bar below
    img_full = Image.new("RGB", (750, 700), color=(240, 242, 245))
    draw_f = ImageDraw.Draw(img_full)

    # Top Status Bar
    draw_f.rectangle([0, 0, 750, 40], fill=(210, 210, 210))
    draw_f.text((15, 12), "9:41 AM | 5G Network | 100% Battery | Sim 1", fill=(30, 30, 30))

    # Truecaller Fraud Warning Banner
    draw_f.rectangle([20, 55, 730, 135], fill=(255, 230, 230), outline=(220, 40, 40), width=2)
    draw_f.text((35, 68), "⚠️ Truecaller Fraud Warning: High Risk Spam / Scam Sender Identified!", fill=(180, 0, 0))
    draw_f.text((35, 95), "Warning: Do not open suspicious short links or share OTPs.", fill=(180, 0, 0))

    # 100% Secure Notice
    draw_f.rectangle([20, 145, 730, 185], fill=(230, 255, 230), outline=(50, 180, 50), width=1)
    draw_f.text((35, 158), "🔒 100% Secure Transaction Guard Protection Enabled", fill=(0, 120, 0))

    # SMS Message Body Box
    draw_f.rectangle([20, 200, 730, 370], fill=(255, 255, 255), outline=(180, 180, 180), width=1)
    draw_f.text((35, 215), "SMS Message from +91-9876543210 (Unknown):", fill=(100, 100, 100))
    fy = 245
    for line in lines:
        draw_f.text((35, fy), line, fill=(0, 0, 0))
        fy += 26

    # Transaction Summary Card
    draw_f.rectangle([20, 385, 730, 540], fill=(230, 240, 255), outline=(100, 150, 255), width=2)
    draw_f.text((35, 400), "Transaction Summary Card (Bank App UI):", fill=(0, 50, 150))
    draw_f.text((35, 430), "Transaction Ref: #TXN-998124 | Amount: Rs 10,001.00", fill=(0, 50, 150))
    draw_f.text((35, 460), "Status: Pending Account Verification | Card: XXXX-4921", fill=(0, 50, 150))
    draw_f.text((35, 490), "Click here to process refund or view bank statement", fill=(0, 50, 150))

    # Phone Status / Navigation Bar below
    draw_f.rectangle([0, 630, 750, 700], fill=(210, 210, 210))
    draw_f.text((250, 655), "Home  |  Recents  |  Back  |  Device Status: Normal", fill=(60, 60, 60))

    img_full.save("fullscreen_sms.png")


def post_multipart(url, file_path, field_name="file"):
    import mimetypes
    mime_type, _ = mimetypes.guess_type(file_path)
    mime_type = mime_type or "image/png"
    
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    with open(file_path, "rb") as f:
        file_bytes = f.read()

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{file_path}"\r\n'
        f"Content-Type: {mime_type}\r\n\r\n"
    ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    create_test_images()

    print("==================================================")
    print("STEP 5.1: TELUGU TRANSLATION TEST (/analyze)")
    print("==================================================")
    url_an = "http://127.0.0.1:8000/analyze"
    pay_tr = {
        "message": EXACT_SMS,
        "language": "te"
    }
    req_tr = urllib.request.Request(
        url_an,
        data=json.dumps(pay_tr).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req_tr) as resp:
        data_tr = json.loads(resp.read().decode("utf-8"))
        print(json.dumps(data_tr, indent=2, ensure_ascii=False))

    print("\n==================================================")
    print("STEP 5.2: VISION EXTRACTION - CROPPED SCREENSHOT")
    print("==================================================")
    url_vis = "http://127.0.0.1:8000/extract-message-from-image"
    res_crop = post_multipart(url_vis, "cropped_sms.png")
    crop_text = res_crop.get("text", "")
    print("EXTRACTED TEXT:")
    print(repr(crop_text))

    print("\n==================================================")
    print("STEP 5.3: VISION EXTRACTION - FULL SCREENSCREEN")
    print("==================================================")
    res_full = post_multipart(url_vis, "fullscreen_sms.png")
    full_text = res_full.get("text", "")
    print("EXTRACTED TEXT:")
    print(repr(full_text))

    print("\n==================================================")
    print("STEP 5.4: VERDICT ANALYSIS ON EXTRACTED TEXT")
    print("==================================================")
    pay_ev = {
        "message": full_text,
        "language": "en"
    }
    req_ev = urllib.request.Request(
        url_an,
        data=json.dumps(pay_ev).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req_ev) as resp:
        data_ev = json.loads(resp.read().decode("utf-8"))
        print(json.dumps(data_ev, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
