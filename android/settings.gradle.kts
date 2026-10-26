pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
// Lets Gradle download the JDK it runs on (gradle/gradle-daemon-jvm.properties): the Android
// tools need JDK 21, whatever Java the computer has installed.
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "pearl-android"

include(":app")
include(":core:model", ":core:data", ":core:sync", ":core:ui")
include(":feature:settings", ":feature:sales", ":feature:bdm")
