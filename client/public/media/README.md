# Landing page demo film

Drop two files here and the demo section appears on the landing page on its own.
Until they exist the section stays hidden — the page checks for the file before
it un-hides, so a missing film reads as "no film yet" rather than as a broken
page.

    taxify-demo.mp4          the film itself
    taxify-demo-poster.jpg   the still shown before it plays

## What it needs to be

About twenty seconds, 16:9, H.264 in an MP4. Keep it under ~6 MB or it becomes
the slowest thing on the page — it is set to `preload="none"`, so nothing
downloads until somebody presses play, but the first press should still be
quick.

The poster is the frame people judge it by. Same 16:9, around 1600x900, JPEG.

## The story it tells

Somebody buys a tool. They photograph the receipt on their phone. It is in
Taxify before they have left the counter. That is the whole product, and it is
worth showing rather than describing.

Narration and music both matter here, so the film is NOT set to autoplay — it
has controls and starts with sound, the way somebody expects when they choose
to press play.
