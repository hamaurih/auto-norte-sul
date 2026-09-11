plugins {
    id("com.android.application")
}

android {
    namespace = "br.com.nortesul.pdv"
    compileSdk = 35

    defaultConfig {
        applicationId = "br.com.nortesul.pdv"
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField(
            "String",
            "POS_URL",
            "\"https://nortesulauto.com.br/admin/pdv?embedded=1\"",
        )
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
