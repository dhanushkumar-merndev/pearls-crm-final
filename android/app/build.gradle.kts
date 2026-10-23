plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// The backend address comes from the repo's root .env (the same browser-safe keys the web app
// uses) or from environment variables (CI). Missing → the app shows "not set up yet".
val rootEnv: Map<String, String> = rootProject.file("../.env").let { file ->
    if (!file.exists()) {
        emptyMap()
    } else {
        file.readLines().mapNotNull { line ->
            val text = line.trim()
            if (text.isEmpty() || text.startsWith("#") || '=' !in text) {
                null
            } else {
                text.substringBefore('=').trim() to
                    text.substringAfter('=').trim().removeSurrounding("\"").removeSurrounding("'")
            }
        }.toMap()
    }
}

fun backend(key: String): String = System.getenv(key)?.takeIf { it.isNotBlank() } ?: rootEnv[key].orEmpty()

fun quoted(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

// Push needs the owner's Firebase file (dev-docs/SETUP.md, git-ignored). Without it the app
// builds and runs; it just gets no push notifications.
val pushEnabled = file("google-services.json").exists()
if (pushEnabled) apply(plugin = libs.plugins.google.services.get().pluginId)

android {
    namespace = "com.pearl.crm"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.pearl.crm"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "SUPABASE_URL", quoted(backend("NEXT_PUBLIC_SUPABASE_URL")))
        buildConfigField("String", "SUPABASE_ANON_KEY", quoted(backend("NEXT_PUBLIC_SUPABASE_ANON_KEY")))
        buildConfigField("boolean", "PUSH_ENABLED", pushEnabled.toString())
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    testOptions.unitTests.isIncludeAndroidResources = true

    lint {
        abortOnError = true
        checkDependencies = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(project(":core:sync"))
    implementation(project(":core:ui"))
    implementation(project(":feature:settings"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.work.runtime)
    implementation(libs.kotlinx.coroutines.android)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation(libs.kotlinx.coroutines.test)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
