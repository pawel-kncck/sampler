"""Shared helpers for the PianoMotion10M comparison (see README.md)."""
import sys, os, json, glob
import numpy as np
from scipy.signal import savgol_filter
from scipy.ndimage import gaussian_filter1d, uniform_filter1d

J0 = np.array([0.0957, 0.0064, 0.0062])  # MANO wrist joint in the template (right hand, mean shape)

def load_clip(path):
    d = json.load(open(path))
    fps = d['fps']
    out = {'bv': d['bv'], 'up': d['up'], 'fps': fps, 'start': d['start_frame'], 'n': len(d['left']), 'fx': d['fx']}
    out['t'] = (d['start_frame'] + np.arange(out['n'])) / fps
    for key, sign in (('R', 1.0), ('L', -1.0)):
        a = np.array(d['right' if key == 'R' else 'left'], float)
        vis = a[:, 0] > 0.5
        tr = a[:, 1:4] + J0  # wrist joint in (mirrored, for the left hand) camera coordinates
        out[key] = {'vis': vis, 'X': sign * tr[:, 0], 'Y': tr[:, 1], 'Z': tr[:, 2], 'orient': a[:, 4:7]}
    return out

def load_ours(path):
    o = json.load(open(path))
    o['t'] = np.arange(len(o['hands']['L']['x'])) / o['fps']
    return o

def ours_at(o, key, ch, t):
    return np.interp(t, o['t'], np.array(o['hands'][key][ch]))

def sg(x):
    """the dataset's own smoothing (Savitzky-Golay, order 3, window 11)"""
    return savgol_filter(x, 11, 3)

def centroid_track(o, key, t, sigma=0.12, eps=0.035):
    """naive baseline: wrist sits at the mean key position of the hand's latest chord, Gaussian-smoothed"""
    notes = sorted([n for n in o['notes'] if n['hand'] == key], key=lambda n: n['start'])
    fps = o['fps']; grid = o['t']
    y = np.full(len(grid), np.nan)
    i = 0
    while i < len(notes):
        j = i
        while j < len(notes) and notes[j]['start'] - notes[i]['start'] < eps: j += 1
        c = np.mean([n['x'] for n in notes[i:j]])
        y[int(max(0, round(notes[i]['start'] * fps))):] = c
        i = j
    if np.all(np.isnan(y)): return np.zeros(len(t))
    first = np.flatnonzero(~np.isnan(y))[0]
    y[:first] = y[first]
    return np.interp(t, grid, gaussian_filter1d(y, sigma * fps))
