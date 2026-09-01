from PIL import Image, ImageDraw
import math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
os.makedirs(OUT, exist_ok=True)

TOP = (10, 132, 255)   # синий
BOT = (52, 199, 89)    # зелёный


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make(size, name, content_scale=0.68, rounded=False):
    SS = 4
    W = size * SS
    img = Image.new('RGB', (W, W))
    d = ImageDraw.Draw(img)

    # градиентный фон
    for y in range(W):
        d.line([(0, y), (W, y)], fill=lerp(TOP, BOT, y / (W - 1)))

    # мягкое светлое пятно
    glow = Image.new('RGB', (W, W))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W * 0.05, -W * 0.25, W * 0.95, W * 0.65], fill=(90, 175, 255))
    img = Image.blend(img, glow, 0.22)
    d = ImageDraw.Draw(img)

    # контент по центру
    box = W * content_scale
    off = (W - box) / 2
    P = [(0.08, 0.22), (0.40, 0.56), (0.55, 0.44), (0.92, 0.80)]
    pts = [(off + x * box, off + y * box) for x, y in P]

    lw = max(2, int(W * 0.075))
    d.line(pts, fill=(255, 255, 255), width=lw, joint='curve')

    # точка в начале
    r = lw * 0.62
    d.ellipse([pts[0][0] - r, pts[0][1] - r, pts[0][0] + r, pts[0][1] + r], fill=(255, 255, 255))

    # стрелка в конце
    (x1, y1), (x2, y2) = pts[-2], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy) or 1
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux
    tip = (x2 + ux * box * 0.045, y2 + uy * box * 0.045)
    bc = (x2 - ux * box * 0.085, y2 - uy * box * 0.085)
    h = box * 0.085
    d.polygon([tip, (bc[0] + nx * h, bc[1] + ny * h), (bc[0] - nx * h, bc[1] - ny * h)], fill=(255, 255, 255))

    img = img.resize((size, size), Image.LANCZOS)

    if rounded:
        mask = Image.new('L', (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=int(size * 4 * 0.22), fill=255)
        mask = mask.resize((size, size), Image.LANCZOS)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        img = out

    path = os.path.join(OUT, name)
    img.save(path)
    print('ok', path)


make(180, 'icon-180.png')
make(192, 'icon-192.png')
make(512, 'icon-512.png')
make(512, 'icon-512-maskable.png', content_scale=0.56)
make(1024, 'icon-1024.png')
