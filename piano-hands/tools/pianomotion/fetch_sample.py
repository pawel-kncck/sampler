"""Download a small, reproducible sample of PianoMotion10M (Zenodo record 13297386).

    python3 fetch_sample.py <data_dir> [videos_per_pianist=4] [seed=20241111]

Fetches the MIDI archive (14 MB) and, for the four most-recorded pianists, two
consecutive 30 s clips of N randomly chosen videos each: the pose
annotations and the matching audio. The big archives (4.4 GB and 2.6 GB) are
not downloaded; single members are read with HTTP range requests.

The dataset is for non-commercial use only; do not redistribute the files.
"""
import collections, io, json, os, random, sys, urllib.request, zipfile

BASE = 'https://zenodo.org/api/records/13297386/files/%s/content'
PIANISTS = ['66685747', '1467634', '478315001', '442401135']
UA = {'User-Agent': 'piano-hands-research'}


class HttpFile(io.RawIOBase):
    """Seekable read-only view of a remote file, fetched in 1 MB blocks."""

    def __init__(self, url, block=1 << 20):
        self.url, self.block, self.pos, self.cache = url, block, 0, {}
        req = urllib.request.Request(url, headers={**UA, 'Range': 'bytes=0-0'})
        with urllib.request.urlopen(req, timeout=120) as r:
            self.size = int(r.headers['Content-Range'].split('/')[1])

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def _blk(self, i):
        if i not in self.cache:
            a, b = i * self.block, min(self.size, (i + 1) * self.block) - 1
            req = urllib.request.Request(self.url, headers={**UA, 'Range': f'bytes={a}-{b}'})
            with urllib.request.urlopen(req, timeout=300) as r:
                self.cache[i] = r.read()
            if len(self.cache) > 64:
                self.cache.pop(next(iter(self.cache)))
        return self.cache[i]

    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        out = bytearray()
        while n > 0 and self.pos < self.size:
            i, o = divmod(self.pos, self.block)
            chunk = self._blk(i)[o:o + n]
            out += chunk; self.pos += len(chunk); n -= len(chunk)
        return bytes(out)

    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)


def remote_zip(name):
    return zipfile.ZipFile(io.BufferedReader(HttpFile(BASE % name), 1 << 20))


def main():
    root = sys.argv[1]
    per = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 20241111
    data = os.path.join(root, 'data')
    os.makedirs(data, exist_ok=True)

    midi_zip = os.path.join(root, 'midi.zip')
    if not os.path.exists(midi_zip):
        print('downloading midi.zip …')
        with urllib.request.urlopen(urllib.request.Request(BASE % 'midi.zip', headers=UA), timeout=600) as r, open(midi_zip, 'wb') as f:
            f.write(r.read())
    with zipfile.ZipFile(midi_zip) as z:
        midis = set(n for n in z.namelist() if n.endswith('.mid'))
        z.extractall(data)

    print('reading the annotation index …')
    ann = remote_zip('annotation.zip')
    vids = collections.defaultdict(list)
    for name in ann.namelist():
        if name.endswith('.json'):
            p = name.split('/')
            vids[(p[-3], p[-2])].append(name)
    random.seed(seed)
    picked = []
    for up in PIANISTS:
        cands = sorted(k for k in vids if k[0] == up and len(vids[k]) >= 4 and f'midi/{up}/{k[1]}.mid' in midis)
        for k in random.sample(cands, per):
            picked += sorted(vids[k])[1:3]
    open(os.path.join(root, 'sample_list.txt'), 'w').write('\n'.join(picked) + '\n')

    audio = remote_zip('audio.zip')
    for name in picked:
        for z, member in ((ann, name), (audio, name.replace('annotation/', 'audio/', 1).replace('.json', '.mp3'))):
            dst = os.path.join(data, member)
            if os.path.exists(dst): continue
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with z.open(member) as src, open(dst, 'wb') as o:
                o.write(src.read())
        print('got', name.split('/')[-1])
    print(f'{len(picked)} clips in {data}')


if __name__ == '__main__':
    main()
