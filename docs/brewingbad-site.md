# Brewing Bad promotional site

The public landing page lives in [BattyDev/brewingbad](https://github.com/BattyDev/brewingbad). The Pages workflow checks out its `main` branch into `brewingbad/`, removes repository metadata and authoring notes, and includes the static files in the existing battydev.com deployment.

The homepage links to `/brewingbad/`. There is no separate domain configuration and no game executable is published by this integration.

Changes in the Brewing Bad repository are picked up by the existing hourly schedule. To publish immediately, run **Deploy site** in this repository. The workflow also accepts `brewingbad-updated` repository dispatch events; no cross-repository token is required for scheduled or manual deployment.
