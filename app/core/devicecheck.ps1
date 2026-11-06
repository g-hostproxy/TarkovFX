# TarkovFX device check: is Equalizer APO active on the current Windows output device?
# Mirrors the detection in Equalizer APO's own DeviceAPOInfo.cpp. Read-only; prints one line of JSON.
$ErrorActionPreference = 'Stop'
$out = @{ ok = $false; defaultGuid = ''; devices = @(); error = '' }
try {
  $src = @"
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ITfxDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out ITfxDevice endpoint);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ITfxDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IntPtr iface);
  int OpenPropertyStore(int access, out IntPtr store);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class TfxDeviceEnumeratorCom { }
public static class TfxAudio {
  public static string DefaultRenderId(int role) {
    ITfxDeviceEnumerator e = (ITfxDeviceEnumerator)(new TfxDeviceEnumeratorCom());
    ITfxDevice d;
    if (e.GetDefaultAudioEndpoint(0, role, out d) != 0 || d == null) return "";
    string id;
    if (d.GetId(out id) != 0) return "";
    return id;
  }
}
"@
  if (-not ('TfxAudio' -as [type])) { Add-Type -TypeDefinition $src -Language CSharp }

  $guidRe = '\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}'
  $defId = [TfxAudio]::DefaultRenderId(0)          # eConsole: what games play through
  if ($defId -match "($guidRe)$") { $out.defaultGuid = $matches[1].ToUpper() }

  $apoGuids = @('{EACD2258-FCAC-4FF4-B36D-419E924A6D79}', '{EC1CC9CE-FAED-4822-828A-82A81A6F018F}')
  $fxKey = '{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},'
  $root = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'
  $list = @()
  foreach ($k in (Get-ChildItem -Path $root -ErrorAction SilentlyContinue)) {
    try {
      $state = (Get-ItemProperty -Path $k.PSPath -ErrorAction SilentlyContinue).DeviceState
      if ($state -ne 1) { continue }                 # 1 = active (plugged in and enabled)
      $props = Get-ItemProperty -Path (Join-Path $k.PSPath 'Properties') -ErrorAction SilentlyContinue
      $fx = Get-ItemProperty -Path (Join-Path $k.PSPath 'FxProperties') -ErrorAction SilentlyContinue
      $installed = $false; $disabled = $false
      if ($fx) {
        foreach ($n in 1, 2, 5, 6, 7, 13, 14, 15) {
          $v = $fx.($fxKey + $n)
          if ($v) { foreach ($x in @($v)) { if ($apoGuids -contains ([string]$x).Trim().ToUpper()) { $installed = $true } } }
        }
        $de = $fx.'{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5'
        if ($de -and [int]$de -ne 0) { $disabled = $true }
      }
      $list += [pscustomobject]@{
        guid = ([string]$k.PSChildName).ToUpper()
        name = [string]$props.'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
        device = [string]$props.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'
        installed = $installed
        enhancementsDisabled = $disabled
      }
    } catch { }
  }
  $out.devices = $list
  $out.ok = $true
} catch {
  $out.error = [string]$_.Exception.Message
}
$out | ConvertTo-Json -Depth 4 -Compress
