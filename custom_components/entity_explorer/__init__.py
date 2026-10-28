"""
Entity Explorer: a sidebar panel that browses Home Assistant as trees.

For more details about this integration, please refer to
https://github.com/hay-kot/ha-entity-explorer
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from homeassistant.components import panel_custom
from homeassistant.components.frontend import async_remove_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.helpers import config_validation as cv

from .const import (
    DOMAIN,
    PANEL_BUNDLE,
    PANEL_ELEMENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STATIC_URL,
)

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.typing import ConfigType

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

FRONTEND_DIR = Path(__file__).parent / "frontend"


async def async_setup(hass: HomeAssistant, _config: ConfigType) -> bool:
    """Serve the panel bundle."""
    # aiohttp cannot remove a route, so the static path is registered once per
    # Home Assistant start here, not on every config entry reload. No cache
    # headers: the bundle URL does not change between builds yet.
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), cache_headers=False)]
    )
    return True


async def async_setup_entry(hass: HomeAssistant, _entry: ConfigEntry) -> bool:
    """Register the sidebar panel."""
    # The static path sends no cache headers, so browsers cache the bundle by
    # its Last-Modified date and keep an old build after an update. A query
    # string tied to the build changes the URL whenever the bundle does.
    bundle_mtime = await hass.async_add_executor_job(
        lambda: int((FRONTEND_DIR / PANEL_BUNDLE).stat().st_mtime)
    )
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{STATIC_URL}/{PANEL_BUNDLE}?v={bundle_mtime}",
        # Admin-only until the spike confirms which registry commands
        # non-admin users can call.
        require_admin=True,
    )
    return True


async def async_unload_entry(hass: HomeAssistant, _entry: ConfigEntry) -> bool:
    """Remove the sidebar panel."""
    async_remove_panel(hass, PANEL_URL_PATH)
    return True
