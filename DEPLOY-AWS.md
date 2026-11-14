# Flowers saytini AWS (EC2) ga joylash

Sayt va admin panel **bitta server**da ishlaydi (`/` va `/admin`). Kerak: AWS akkaunt va (tavsiya) domen.

> **Narx haqida.** AWS bepul shartlari o'zgarib turadi (yangi akkauntlarga bepul kredit yoki 12 oylik `t2/t3.micro`). Boshlashdan oldin https://aws.amazon.com/free sahifasida o'zingizning akkauntingiz uchun shartni tekshiring va **Billing → Budgets** da 1–5 USD ogohlantirish qo'ying. Bepul muddat tugagach pul yechiladi.

## 1. Server yaratish (EC2)

1. AWS Console → **EC2 → Launch instance**.
2. **Name**: `flowers`
3. **Image**: Ubuntu Server 24.04 LTS.
4. **Instance type**: `t3.micro` (yoki "Free tier eligible" deb belgilangan tur).
5. **Key pair**: Create new → `flowers-key` → `.pem` faylni yuklab oling va yo'qotmang.
6. **Network settings → Security group**, 3 ta qoida:
   - SSH (22): **My IP**
   - HTTP (80): Anywhere
   - HTTPS (443): Anywhere
7. **Storage**: 20 GB gp3.
8. **Launch instance**.
9. **EC2 → Elastic IPs → Allocate → Associate** (serverga). Bu server qayta ishga tushganda IP o'zgarmasligi uchun. Uni serverga ulang, aks holda pullik.

## 2. Loyihani yuklash (Windows PowerShell)

`flowers-deploy.zip` va `flowers-key.pem` Downloads papkasida deb faraz qilamiz. `SERVER_IP` o'rniga Elastic IP ni yozing:

```powershell
cd C:\Users\1\Downloads
scp -i flowers-key.pem flowers-deploy.zip ubuntu@SERVER_IP:~
ssh -i flowers-key.pem ubuntu@SERVER_IP
```

Server ichida (ssh dan keyin):

```bash
sudo apt-get update && sudo apt-get install -y unzip
sudo mkdir -p /opt/flowers
sudo unzip ~/flowers-deploy.zip -d /opt/flowers
sudo bash /opt/flowers/deploy/setup.sh sizning-domeningiz.uz
```

Domen hali bo'lmasa: `sudo bash /opt/flowers/deploy/setup.sh` (domensiz, IP orqali ishlaydi).

Skript oxirida **admin paroli** chiqadi (`FIRST START: admin login "admin", password "..."`). Uni **bir marta** ko'rasiz, yozib oling. Chiqmasa:

```bash
sudo -u flowers env HOME=/opt/flowers PM2_HOME=/opt/flowers/.pm2 pm2 logs flowers --lines 50 --nostream
```

## 3. Domen va HTTPS (tavsiya etiladi)

1. Domen provayderingizda **A yozuv** qo'shing: `sizning-domeningiz.uz` → Elastic IP. (10–60 daqiqa kutish mumkin.)
2. Serverda:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d sizning-domeningiz.uz
```

HTTPS bo'lmasa, admin paroli internetda ochiq matnda yuboriladi. Domensiz (faqat IP) ishlatsangiz, `/admin` ga kirmang.

## 4. Telegramdagi rasm havolasi

`/opt/flowers/config.json` ni oching:

```bash
sudo nano /opt/flowers/config.json
```

`"siteUrl": ""` ni o'zgartiring: `"siteUrl": "https://sizning-domeningiz.uz"`. Keyin:

```bash
sudo -u flowers env HOME=/opt/flowers PM2_HOME=/opt/flowers/.pm2 pm2 restart flowers
```

Shu yerda telefon, manzil, email va Telegram nomini ham haqiqiylariga almashtiring.

## 5. Birinchi kirishdan keyin

- `https://sizning-domeningiz.uz/admin` ga kiring.
- **Adminlar** yorlig'ida o'zingizning loginingizni yarating, shu bilan kirib, `admin` ni o'chiring. (Parolni o'zgartirish tugmasi yo'q, yangi admin yaratib eskisini o'chirasiz.)

## 6. Keyingi ishlar

**Kodni yangilash.** Faqat kod fayllarini (`server.js`, `public/*.js`, `public/*.css`, `public/*.html`, `seed.js`) yuklang. `data/` va `public/photos/` ni ustiga yozmang, aks holda buketlaringiz o'chadi. Keyin:

```bash
sudo bash /opt/flowers/deploy/update.sh
```

**Zaxira nusxa.** Har kuni 03:30 da `data/` va rasmlar `/var/backups/flowers/` ga saqlanadi (14 kun). Muhim: bu zaxira o'sha serverning o'zida turadi, server o'chib ketsa u ham yo'qoladi. Vaqti-vaqti bilan yuklab oling:

```powershell
scp -i flowers-key.pem "ubuntu@SERVER_IP:/var/backups/flowers/*.tar.gz" C:\Users\1\Downloads\
```

**Holatni tekshirish.**

```bash
sudo -u flowers env HOME=/opt/flowers PM2_HOME=/opt/flowers/.pm2 pm2 status
```

## Cheklovlar

- Ma'lumotlar fayllarda saqlanadi (baza yo'q). Bitta server uchun yetarli, bir nechta serverga bo'lib bo'lmaydi.
- `t3.micro` da 1 GB xotira bor, skript 1 GB swap qo'shadi. Kichik do'kon uchun yetadi.
- Admin kirishida 10 marta xato urinishdan keyin 10 daqiqa blok bor, lekin ikki bosqichli tasdiqlash yo'q: kuchli parol qo'ying.
