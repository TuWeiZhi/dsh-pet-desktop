param(
  [int]$Frames = 20,
  [int]$IntervalMs = 400,
  [string]$Label = ''
)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W2 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static string Find(uint[] pids) {
    string found = null;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (Array.IndexOf(pids, pid) < 0) return true;
      if (!IsWindowVisible(h)) return true;
      RECT r; GetWindowRect(h, out r);
      int w = r.Right - r.Left, hh = r.Bottom - r.Top;
      if (w > 200 && hh > 200) found = r.Left + "|" + r.Top + "|" + w + "|" + hh;
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$pids = (Get-Process dsh-pet -ErrorAction SilentlyContinue).Id | ForEach-Object { [uint32]$_ }
if (-not $pids) { "no dsh-pet process"; exit 1 }
$r = [W2]::Find($pids)
if (-not $r) { "pet window not found"; exit 1 }
$parts = $r.Split('|')
$L = [int]$parts[0]; $T = [int]$parts[1]; $Wd = [int]$parts[2]; $Ht = [int]$parts[3]
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$cl = [Math]::Max($L, $bounds.Left); $ct = [Math]::Max($T, $bounds.Top)
$cr = [Math]::Min($L + $Wd, $bounds.Right); $cb = [Math]::Min($T + $Ht, $bounds.Bottom)
$cw = $cr - $cl; $ch = $cb - $ct
"[$Label] window=$L,$T ${Wd}x${Ht} clip=$cl,$ct ${cw}x${ch}"
$prev = $null
$out = @()
for ($i = 0; $i -lt $Frames; $i++) {
  $bmp = New-Object System.Drawing.Bitmap $cw, $ch
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($cl, $ct, 0, 0, (New-Object System.Drawing.Size $cw, $ch))
  $g.Dispose()
  if ($null -ne $prev) {
    $diff = 0
    for ($y = 0; $y -lt $ch; $y += 4) {
      for ($x = 0; $x -lt $cw; $x += 4) {
        if ($bmp.GetPixel($x, $y).ToArgb() -ne $prev.GetPixel($x, $y).ToArgb()) { $diff++ }
      }
    }
    $out += ("{0:d2} {1}" -f $i, $diff)
  } else {
    $out += "00 base"
  }
  if ($null -ne $prev) { $prev.Dispose() }
  $prev = $bmp
  Start-Sleep -Milliseconds $IntervalMs
}
$prev.Dispose()
$out -join "`n"
