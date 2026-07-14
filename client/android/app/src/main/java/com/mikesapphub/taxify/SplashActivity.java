package com.mikesapphub.taxify;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

public class SplashActivity extends AppCompatActivity {

    private static final long HOLD_MS = 1600;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_splash);

        ImageView logo = findViewById(R.id.splashLogo);
        TextView title = findViewById(R.id.splashTitle);
        ProgressBar progress = findViewById(R.id.splashProgress);
        TextView footer = findViewById(R.id.splashFooter);

        logo.setScaleX(0.75f);
        logo.setScaleY(0.75f);

        AnimatorSet entrance = new AnimatorSet();
        entrance.playTogether(
            fadeIn(logo, 0),
            scaleInX(logo, 0),
            scaleInY(logo, 0),
            fadeIn(title, 150),
            fadeIn(progress, 300),
            fadeIn(footer, 400)
        );
        entrance.start();

        entrance.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                startPulse(logo);
            }
        });

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            startActivity(new Intent(SplashActivity.this, MainActivity.class));
            overridePendingTransition(R.anim.fade_in, R.anim.fade_out);
            finish();
        }, HOLD_MS);
    }

    private ObjectAnimator fadeIn(View view, long startDelay) {
        ObjectAnimator anim = ObjectAnimator.ofFloat(view, View.ALPHA, 0f, 1f);
        anim.setDuration(450);
        anim.setStartDelay(startDelay);
        return anim;
    }

    private ObjectAnimator scaleInX(View view, long startDelay) {
        ObjectAnimator anim = ObjectAnimator.ofFloat(view, View.SCALE_X, 0.75f, 1f);
        anim.setDuration(450);
        anim.setStartDelay(startDelay);
        return anim;
    }

    private ObjectAnimator scaleInY(View view, long startDelay) {
        ObjectAnimator anim = ObjectAnimator.ofFloat(view, View.SCALE_Y, 0.75f, 1f);
        anim.setDuration(450);
        anim.setStartDelay(startDelay);
        return anim;
    }

    private void startPulse(ImageView logo) {
        ObjectAnimator scaleX = ObjectAnimator.ofFloat(logo, View.SCALE_X, 1f, 1.08f, 1f);
        ObjectAnimator scaleY = ObjectAnimator.ofFloat(logo, View.SCALE_Y, 1f, 1.08f, 1f);
        AnimatorSet pulse = new AnimatorSet();
        pulse.playTogether(scaleX, scaleY);
        pulse.setDuration(1000);
        pulse.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                if (!isFinishing()) startPulse(logo);
            }
        });
        pulse.start();
    }
}
