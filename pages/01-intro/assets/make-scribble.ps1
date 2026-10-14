# Renders a ballpoint-pen scribble version of a photo: many short random-walk
# strokes whose density and opacity follow the image's darkness, plus a few
# long loose loops over the whole sheet. Output is blue ink on transparency.
param(
  [string]$Src,
  [string]$Dst,
  [double]$Scale = 2.0,
  [int]$Strokes = 140000,
  [int]$Loops = 350,
  [int]$Seed = 7
)

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class Scribble {
  public static void Make(string src, string dst, double scale, int strokes, int loops, int seed) {
    Bitmap photo = new Bitmap(src);
    int w = photo.Width, h = photo.Height;
    float[] dark = new float[w * h];
    BitmapData bd = photo.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    byte[] px = new byte[bd.Stride * h];
    Marshal.Copy(bd.Scan0, px, 0, px.Length);
    photo.UnlockBits(bd);
    float[] lumA = new float[w * h];
    for (int y = 0; y < h; y++) {
      for (int x = 0; x < w; x++) {
        int i = y * bd.Stride + x * 4;
        lumA[y * w + x] = (float)((0.299 * px[i + 2] + 0.587 * px[i + 1] + 0.114 * px[i]) / 255.0);
      }
    }
    photo.Dispose();

    // Blur a little, then gradient (Sobel): magnitude = "edgeness", tangent = contour direction.
    float[] blur = new float[w * h];
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      float sum = 0; int c = 0;
      for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) {
        int xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        sum += lumA[yy * w + xx]; c++;
      }
      blur[y * w + x] = sum / c;
    }
    float[] gm = new float[w * h];
    float[] tang = new float[w * h];
    for (int y = 1; y < h - 1; y++) for (int x = 1; x < w - 1; x++) {
      float gx = (blur[(y - 1) * w + x + 1] + 2 * blur[y * w + x + 1] + blur[(y + 1) * w + x + 1])
               - (blur[(y - 1) * w + x - 1] + 2 * blur[y * w + x - 1] + blur[(y + 1) * w + x - 1]);
      float gy = (blur[(y + 1) * w + x - 1] + 2 * blur[(y + 1) * w + x] + blur[(y + 1) * w + x + 1])
               - (blur[(y - 1) * w + x - 1] + 2 * blur[(y - 1) * w + x] + blur[(y - 1) * w + x + 1]);
      gm[y * w + x] = (float)Math.Min(1.0, Math.Sqrt(gx * gx + gy * gy) * 2.2);
      tang[y * w + x] = (float)(Math.Atan2(gy, gx) + Math.PI / 2);
    }

    // Density: darkness, steepened, and weighted toward edges so flat dark
    // areas (the background) stay loose while hair and features go dense.
    for (int i = 0; i < w * h; i++) {
      double d = 1.0 - lumA[i];
      d = Math.Pow(Math.Max(0, (d - 0.1) / 0.9), 1.7);
      double e = Math.Min(1.0, gm[i] * 2.5);
      dark[i] = (float)(d * (0.14 + 0.86 * e) + 0.35 * e);
    }

    int W = (int)(w * scale), H = (int)(h * scale);
    Bitmap outBmp = new Bitmap(W, H, PixelFormat.Format32bppArgb);
    Graphics g = Graphics.FromImage(outBmp);
    g.SmoothingMode = SmoothingMode.AntiAlias;
    g.Clear(Color.Transparent);
    Random r = new Random(seed);
    Color ink = Color.FromArgb(34, 48, 196);

    // Short strokes: start where it is dark, wander, stop when it gets light.
    List<PointF> pts = new List<PointF>(80);
    for (int s = 0; s < strokes; s++) {
      int sx, sy; int tries = 0;
      do {
        sx = r.Next(w); sy = r.Next(h); tries++;
      } while (r.NextDouble() > dark[sy * w + sx] * 0.9 + 0.004 && tries < 40);
      double ang = r.NextDouble() * Math.PI * 2;
      double turn = (r.NextDouble() - 0.5) * 0.7;
      double x = sx, y = sy;
      pts.Clear();
      double dsum = 0; int n = 0;
      int maxLen = 16 + r.Next(40);
      for (int k = 0; k < maxLen; k++) {
        pts.Add(new PointF((float)(x * scale), (float)(y * scale)));
        int ix = (int)x, iy = (int)y;
        if (ix < 0 || iy < 0 || ix >= w || iy >= h) break;
        double d = dark[iy * w + ix];
        dsum += d; n++;
        if (k > 3 && r.NextDouble() > d * 1.05 + 0.04) break;
        // Steer toward the local contour direction where there is an edge;
        // scribble freely where the image is flat.
        double e = gm[iy * w + ix];
        if (e > 0.08) {
          double tt = tang[iy * w + ix];
          double diff = Math.Atan2(Math.Sin(tt - ang), Math.Cos(tt - ang));
          if (Math.Abs(diff) > Math.PI / 2) diff = Math.Atan2(Math.Sin(tt + Math.PI - ang), Math.Cos(tt + Math.PI - ang));
          ang += diff * Math.Min(1.0, e * 2.5) * 0.55;
        }
        ang += turn * (1 - Math.Min(1.0, e * 2.5) * 0.8) + (r.NextDouble() - 0.5) * 0.45;
        turn += (r.NextDouble() - 0.5) * 0.12;
        turn = Math.Max(-0.9, Math.Min(0.9, turn));
        double step = 2.2 + r.NextDouble() * 2.5;
        x += Math.Cos(ang) * step; y += Math.Sin(ang) * step;
      }
      if (pts.Count < 3) continue;
      double avg = n > 0 ? dsum / n : 0;
      int alpha = (int)(38 + 130 * Math.Min(1.0, avg));
      using (Pen p = new Pen(Color.FromArgb(alpha, ink), (float)(0.65 * scale))) {
        p.StartCap = LineCap.Round; p.EndCap = LineCap.Round; p.LineJoin = LineJoin.Round;
        g.DrawCurve(p, pts.ToArray(), 0.45f);
      }
    }

    // Long loose loops anywhere on the sheet (the stray lines in the margins).
    for (int s = 0; s < loops; s++) {
      double x = r.NextDouble() * w, y = r.NextDouble() * h;
      double ang = r.NextDouble() * Math.PI * 2;
      double turn = (r.NextDouble() - 0.5) * 0.25;
      pts.Clear();
      int len = 120 + r.Next(220);
      for (int k = 0; k < len; k++) {
        pts.Add(new PointF((float)(x * scale), (float)(y * scale)));
        ang += turn + (r.NextDouble() - 0.5) * 0.12;
        turn += (r.NextDouble() - 0.5) * 0.04;
        turn = Math.Max(-0.35, Math.Min(0.35, turn));
        double step = 3.0 + r.NextDouble() * 2.0;
        x += Math.Cos(ang) * step; y += Math.Sin(ang) * step;
        if (x < -40 || y < -40 || x > w + 40 || y > h + 40) break;
      }
      if (pts.Count < 3) continue;
      using (Pen p = new Pen(Color.FromArgb(60, ink), (float)(0.6 * scale))) {
        p.StartCap = LineCap.Round; p.EndCap = LineCap.Round; p.LineJoin = LineJoin.Round;
        g.DrawCurve(p, pts.ToArray(), 0.5f);
      }
    }

    g.Dispose();
    outBmp.Save(dst, ImageFormat.Png);

    // Half-size preview composited on paper, for checking.
    Bitmap prev = new Bitmap(W / 2, H / 2, PixelFormat.Format24bppRgb);
    Graphics pg = Graphics.FromImage(prev);
    pg.InterpolationMode = InterpolationMode.HighQualityBicubic;
    pg.Clear(Color.FromArgb(230, 230, 234));
    pg.DrawImage(outBmp, 0, 0, W / 2, H / 2);
    pg.Dispose();
    prev.Save(dst.Replace(".png", "-preview.jpg"), ImageFormat.Jpeg);
    prev.Dispose();
    outBmp.Dispose();
  }
}
"@

[Scribble]::Make((Resolve-Path $Src).Path, $Dst, $Scale, $Strokes, $Loops, $Seed)
Get-Item $Dst | Select-Object Name, Length
