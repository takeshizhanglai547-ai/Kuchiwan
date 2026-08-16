# ============================================================
#  ObCore test build. Engine-free by design: this is the only
#  part of the Unreal target that can be compiled and RUN in the
#  authoring container, so it is where every verified number
#  about the Unreal build comes from.
# ============================================================
cmake_minimum_required(VERSION 3.20)
project(obtests CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Unreal builds with exceptions and RTTI off; match it so ObCore cannot
# quietly acquire a dependency on either.
add_compile_options(-Wall -Wextra -Wshadow -fno-exceptions -fno-rtti)

set(OBCORE ${CMAKE_CURRENT_SOURCE_DIR}/../OverburstUE/Source/ObCore)
file(GLOB OBCORE_SRC ${OBCORE}/Private/*.cpp)
file(GLOB TEST_SRC ${CMAKE_CURRENT_SOURCE_DIR}/*.cpp)

add_executable(obtests ${TEST_SRC} ${OBCORE_SRC})

# The Unreal module is NOT built here and cannot be. Two of its headers are
# deliberately engine-free — ObUnits.h (the metre/centimetre, Y-up/Z-up
# boundary) and ObMechRig.h (the frame definition AC_DESIGN.md states as hard
# proportion targets) — and putting its Public directory on the include path is
# what lets test_ue_layer.cpp measure them. Nothing else in that module is
# reachable from here: everything else in it includes CoreMinimal.h and would
# fail to compile instantly if this were ever used to pull in more.
set(OBUE ${CMAKE_CURRENT_SOURCE_DIR}/../OverburstUE/Source/OverburstUE)

target_include_directories(obtests PRIVATE
  ${OBCORE}/Public
  ${OBUE}/Public
  ${CMAKE_CURRENT_SOURCE_DIR})
