import webbrowser

from fastmcp.client.auth.oauth import OAuth as _FastMCPOAuth


class OpenEdisonOAuth(_FastMCPOAuth):
    async def redirect_handler(self, authorization_url: str) -> None:  # noqa: ARG002
        # Print a clean, single-line URL and still open the browser.
        print(f"OAuth authorization URL: {authorization_url}", flush=True)
        webbrowser.open(authorization_url)
