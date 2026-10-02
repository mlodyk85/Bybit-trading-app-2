# MT5 Bridge

Small dependency-free Node.js service between the Android app and the MT5 Expert Advisor.

## Run locally / on VPS

```bash
cd mt5-bridge
export MT5_BRIDGE_TOKEN="replace-with-a-long-random-token"
node server.js
```

Default port: `8787`.

Docker:

```bash
docker build -t mt5-bridge .
docker run -d --restart unless-stopped -p 8787:8787 -e MT5_BRIDGE_TOKEN="replace-with-a-long-random-token" mt5-bridge
```

## MT5 setup

In the EA inputs set:

- `InpBridgeEnabled = true`
- `InpBridgeUrl = http://YOUR_VPS_OR_PC:8787`
- `InpBridgeToken = the same token as MT5_BRIDGE_TOKEN`

Then in MT5 open **Tools → Options → Expert Advisors** and add the exact Bridge base URL to **Allow WebRequest for listed URL**.

## Android app

Open the **MT5** tab, enter the same Bridge URL and token, then tap **ZAPISZ I TESTUJ**.

The app can:
- read current equity/balance/free margin,
- see daily realized PnL and basket PnL,
- see number of MT5 positions,
- START new entries,
- STOP new entries without force-closing,
- CLOSE ALL positions managed by the EA,
- RESET DAY LOCK.

## Security

The Bridge token is required on both MT5 and mobile requests. Do not expose port 8787 publicly without firewall/VPN/reverse-proxy protection. For remote internet access, place the Bridge behind HTTPS or a VPN such as Tailscale/WireGuard.

The Bridge intentionally does not store broker login/password and does not need MT5 account credentials.
