package com.menova.studio;

import org.junit.Test;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class NavigationPolicyTest {
    @Test
    public void keepsWebsiteRoutesInsideApp() {
        assertTrue(NavigationPolicy.isInternal(BuildConfig.SITE_URL));
        assertTrue(NavigationPolicy.isInternal(BuildConfig.SITE_URL + "dashboard"));
        assertTrue(NavigationPolicy.isInternal(BuildConfig.SITE_URL + "viewer/demo?edit=1#hotspot"));
        assertTrue(NavigationPolicy.isInternal("https://MENOVA-FLAX.vercel.app:443/dashboard"));
    }

    @Test
    public void rejectsLookalikeOriginsAndNonHttpsNavigation() {
        String[] urls = {
                "https://menova-flax.vercel.app.attacker.example/",
                "https://menova-flax.vercel.app@attacker.example/",
                "https://attacker.example@menova-flax.vercel.app/",
                "http://menova-flax.vercel.app/",
                "https://menova-flax.vercel.app:8443/",
                "file:///etc/passwd", "javascript:alert(1)", "data:text/html,hello",
                "intent://example", "content://downloads/1", "/dashboard", "", null
        };
        for (String url : urls) assertFalse(String.valueOf(url), NavigationPolicy.isInternal(url));
    }

    @Test
    public void allowsBrowserEmailAndPhoneLinks() {
        assertTrue(NavigationPolicy.isExternalAllowed("https://example.com/path"));
        assertTrue(NavigationPolicy.isExternalAllowed(BuildConfig.SITE_URL + "viewer/demo"));
        assertTrue(NavigationPolicy.isExternalAllowed("mailto:hello@example.com"));
        assertTrue(NavigationPolicy.isExternalAllowed("tel:+15555550100"));
    }

    @Test
    public void rejectsUnsafeExternalSchemesAndMalformedUrls() {
        String[] urls = {
                "javascript:alert(1)", "intent://example", "file:///etc/passwd",
                "data:text/html,hello", "content://downloads/1", "http://example.com/",
                "https://user:password@example.com", "https:///missing-host", "%broken", "", null
        };
        for (String url : urls) assertFalse(String.valueOf(url), NavigationPolicy.isExternalAllowed(url));
    }
}