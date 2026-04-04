route/*.gif — 3s loops from public/videos/how-to-reach/goko-hostel-parking-walkthrough.mp4
(regenerate with ffmpeg if you replace the master clip; paths must match src/content/howToReach.ts).

Example encode (compact, portrait 300px wide):

  ffmpeg -y -ss START_SEC -t 3 -i goko-hostel-parking-walkthrough.mp4 \
    -vf "fps=6,scale=300:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" \
    -loop 0 route/NN-name.gif
