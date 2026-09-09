package com.menova.studio;

import java.net.URI;

final class NavigationPolicy {
    private NavigationPolicy() {}

    static boolean isInternal(String url) {
        try {
            URI target = URI.create(url);
            URI site = URI.create(BuildConfig.SITE_URL);
            return "https".equalsIgnoreCase(target.getScheme())
                    && site.getHost().equalsIgnoreCase(target.getHost())
                    && target.getRawUserInfo() == null
                    && (target.getPort() == -1 || target.getPort() == 443);
        } catch (IllegalArgumentException | NullPointerException exception) {
            return false;
        }
    }

    static boolean isExternalAllowed(String url) {
        try {
            URI target = URI.create(url);
            String scheme = target.getScheme();
            return ("https".equalsIgnoreCase(scheme) && target.getHost() != null
                    && target.getRawUserInfo() == null)
                    || "mailto".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme);
        } catch (IllegalArgumentException | NullPointerException exception) {
            return false;
        }
    }
}